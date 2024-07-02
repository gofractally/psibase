#include <services/system/TransactionQueue.hpp>

#include <services/system/Transact.hpp>

#include <psibase/dispatch.hpp>

using namespace psibase;
using namespace SystemService;

std::optional<SignedTransaction> SystemService::TransactionQueue::next()
{
   auto unapplied = WriteOnly{}.open<UnappliedTransactionTable>();
   auto nextSequence =
       unapplied.get(SingletonKey{}).value_or(UnappliedTransactionRecord{0}).nextSequence;
   auto included = Transact::Tables{Transact::service}.open<IncludedTrxTable>();
   PSIBASE_SUBJECTIVE_TX
   {
      auto table = Subjective{}.open<PendingTransactionTable>();
      auto index = table.getIndex<1>();
      for (auto iter = index.lower_bound(nextSequence), end = index.end(); iter != end; ++iter)
      {
         auto item = *iter;
         if (!included.get(std::tuple(item.expiration, item.id)))
         {
            unapplied.put({nextSequence});
            auto trxData = Subjective{}.open<TransactionDataTable>();
            if (auto result = trxData.get(item.id))
            {
               return std::move(result->trx);
            }
            check(false, "Internal error: missing transaction data");
         }
         nextSequence = item.sequence + 1;
      }
      unapplied.put({nextSequence});
      return {};
   }
   __builtin_unreachable();
}

std::optional<psibase::HttpReply> TransactionQueue::serveSys(const psibase::HttpRequest& request)
{
   if (request.method == "POST" && request.target == "/push_transaction")
   {
      if (request.contentType != "application/octet-stream")
         abortMessage("Expected fracpack encoded signed transaction (application/octet-stream)");
      auto trx = psio::from_frac<SignedTransaction>(request.body);

      auto id = psibase::sha256(trx.transaction.data(), trx.transaction.size());
      PSIBASE_SUBJECTIVE_TX
      {
         auto pending = Subjective{}.open<PendingTransactionTable>();
         if (pending.get(id))
            break;
         // Find the next sequence number
         auto available = Subjective{}.open<AvailableSequenceTable>();
         auto sequence =
             available.get(SingletonKey{}).value_or(AvailableSequenceRecord{0}).nextSequence;
         available.put({sequence + 1});
         pending.put({.id         = id,
                      .expiration = trx.transaction->tapos().expiration(),
                      .ctime      = {static_cast<std::uint32_t>(
                          std::chrono::time_point_cast<std::chrono::seconds>(
                              std::chrono::system_clock::now())
                              .time_since_epoch()
                              .count())},
                      .sequence   = sequence});
         Subjective{}.open<TransactionDataTable>().put({id, std::move(trx)});
      }
      return HttpReply{.contentType = "application/json", .body = std::vector{'t', 'r', 'u', 'e'}};
   }
   return {};
}

PSIBASE_DISPATCH(TransactionQueue)
