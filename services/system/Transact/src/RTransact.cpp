#include <services/system/HttpServer.hpp>
#include <services/system/RTransact.hpp>
#include <services/system/Transact.hpp>

#include <psibase/dispatch.hpp>
#include <psibase/serveSchema.hpp>

using namespace psibase;
using namespace SystemService;

std::optional<SignedTransaction> SystemService::RTransact::next()
{
   check(getSender() == Transact::service, "Wrong sender");
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
         auto item    = *iter;
         nextSequence = item.sequence + 1;
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
      }
      unapplied.put({nextSequence});
      return {};
   }
   __builtin_unreachable();
}

void RTransact::onTrx(const Checksum256& id, const TransactionTrace& trace)
{
   check(getSender() == AccountNumber{}, "Wrong sender");
   auto                          clients = Subjective{}.open<TraceClientTable>();
   std::optional<TraceClientRow> row;
   PSIBASE_SUBJECTIVE_TX
   {
      row = clients.get(id);
      if (row)
         clients.remove(*row);
   }
   if (row)
   {
      HttpReply           reply{.contentType = "application/json"};
      psio::vector_stream stream{reply.body};
      to_json(trace, stream);
      for (std::int32_t sock : row->sockets)
         to<HttpServer>().sendReply(sock, reply);
   }
}

void RTransact::onBlock()
{
   check(getSender() == AccountNumber{}, "Wrong sender");
   // Update reversible table and find the time of the last commit
   auto stat = psibase::kvGet<psibase::StatusRow>(psibase::StatusRow::db, psibase::statusKey());
   if (!stat)
      return;
   auto commitNum  = stat->current.commitNum;
   auto reversible = WriteOnly{}.open<ReversibleBlocksTable>();
   reversible.put({.blockNum = stat->current.blockNum, .time = stat->current.time});
   TimePointSec irreversibleTime = {};
   for (auto r : reversible.getIndex<0>())
   {
      if (r.blockNum > commitNum)
         break;
      irreversibleTime = r.time;
      if (r.blockNum < commitNum)
         reversible.remove(r);
   }
   // Remove expired transactions and find associated requests
   std::vector<TraceClientRow> ids;
   PSIBASE_SUBJECTIVE_TX
   {
      auto table       = Subjective{}.open<PendingTransactionTable>();
      auto dataTable   = Subjective{}.open<TransactionDataTable>();
      auto clientTable = Subjective{}.open<TraceClientTable>();
      auto index       = table.getIndex<3>();
      for (auto item : index)
      {
         if (item.expiration > irreversibleTime)
            break;
         if (auto client = clientTable.get(item.id))
         {
            ids.push_back(*client);
            clientTable.remove(*client);
         }
         dataTable.erase(item.id);
         table.remove(item);
      }
   }
   // Send responses to everyone waiting for a transaction that expired
   if (!ids.empty())
   {
      TransactionTrace    trace{.error = "Transaction expired"};
      HttpReply           reply{.contentType = "application/json"};
      psio::vector_stream stream{reply.body};
      to_json(trace, stream);
      for (auto row : ids)
      {
         for (auto sock : row.sockets)
            to<HttpServer>().sendReply(sock, reply);
      }
   }
}

namespace
{
   using Subjective = RTransact::Subjective;
   using WriteOnly  = RTransact::WriteOnly;
   bool pushTransaction(const Checksum256& id, const SignedTransaction& trx)
   {
      PSIBASE_SUBJECTIVE_TX
      {
         auto pending = Subjective{}.open<PendingTransactionTable>();
         if (pending.get(id))
         {
            return false;
         }
         // Find the next sequence number
         auto available = Subjective{}.open<AvailableSequenceTable>();
         auto sequence =
             available.get(SingletonKey{}).value_or(AvailableSequenceRecord{0}).nextSequence;
         available.put({sequence + 1});
         pending.put({.id         = id,
                      .expiration = trx.transaction->tapos().expiration(),
                      .ctime      = std::chrono::time_point_cast<psibase::Seconds>(
                          std::chrono::system_clock::now()),
                      .sequence = sequence});
         Subjective{}.open<TransactionDataTable>().put({id, std::move(trx)});
      }
      return true;
   }
   void forwardTransaction(const SignedTransaction& trx)
   {
      to<HttpServer>().sendProds(
          transactor<RTransact>(HttpServer::service, RTransact::service).recv(trx));
   }
}  // namespace

void RTransact::recv(const SignedTransaction& trx)
{
   check(getSender() == HttpServer::service, "Wrong sender");
   auto id = psibase::sha256(trx.transaction.data(), trx.transaction.size());
   if (pushTransaction(id, trx))
      forwardTransaction(trx);
}

std::optional<HttpReply> RTransact::serveSys(const psibase::HttpRequest& request,
                                             std::optional<std::int32_t> socket)
{
   check(getSender() == HttpServer::service, "Wrong sender");
   check(socket.has_value(), "Missing socket");
   if (request.method == "POST" && request.target == "/push_transaction")
   {
      if (request.contentType != "application/octet-stream")
         abortMessage("Expected fracpack encoded signed transaction (application/octet-stream)");
      auto trx = psio::from_frac<SignedTransaction>(request.body);
      auto id  = psibase::sha256(trx.transaction.data(), trx.transaction.size());
      PSIBASE_SUBJECTIVE_TX
      {
         auto clients = Subjective{}.open<TraceClientTable>();
         auto row     = clients.get(id).value_or(TraceClientRow{.id = id});
         row.sockets.push_back(*socket);
         clients.put(row);
         to<HttpServer>().deferReply(*socket);
      }
      if (pushTransaction(id, trx))
         forwardTransaction(trx);
   }
   else if (auto res = serveSchema<Transact>(request))
   {
      return res;
   }

   return {};
}

PSIBASE_DISPATCH(RTransact)
