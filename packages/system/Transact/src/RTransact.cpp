#include <services/local/XAdmin.hpp>
#include <services/local/XRun.hpp>
#include <services/local/XTransact.hpp>
#include <services/system/Accounts.hpp>
#include <services/system/HttpServer.hpp>
#include <services/system/RTransact.hpp>
#include <services/system/SetCode.hpp>
#include <services/system/Transact.hpp>

#include <functional>
#include <psibase/dispatch.hpp>
#include <psibase/jwt.hpp>
#include <psibase/serveGraphQL.hpp>
#include <ranges>

using namespace psibase;
using namespace SystemService;
using namespace LocalService;

namespace
{
   // Must be run inside PSIBASE_SUBJECTIVE_TX
   void scheduleVerify(const Checksum256&           id,
                       const SignedTransaction&     trx,
                       bool                         verified,
                       std::optional<std::uint64_t> speculative);

   void cancelSpeculative(const std::optional<std::uint64_t>& id);
   void forwardTransaction(const SignedTransaction& trx);

   // Flushes the transaction queue and schedules all the
   // transactions in it to have their signatures verified again.
   // verifyId identifies the set of verify services.
   //
   // must be run inside a subjective-tx.
   void flushTransactions(ReverifySignaturesTable&  reverify,
                          ReverifySignaturesRecord& row,
                          const Checksum256&        verifyId)
   {
      auto available     = RTransact{}.open<AvailableSequenceTable>();
      auto nextAvailable = available.get({}).value_or(AvailableSequenceRecord{0}).nextSequence;
      bool running       = row.running;
      row                = {.endSequence = nextAvailable, .verifyId = verifyId, .running = true};
      reverify.put(row);

      if (!running)
      {
         transactor<RTransact> rtransact{RTransact::service, RTransact::service};
         to<XRun>().post(RunMode::rpc, rtransact.requeue(), MicroSeconds::max(),
                         MethodNumber{"onRequeue"});
      }
   }

   bool validateTransaction(const Checksum256& id, const SignedTransaction& trx)
   {
      check(trx.transaction->claims().size() == trx.proofs.size(),
            "proofs and claims must have same size");
      return to<Transact>().checkFirstAuth(id, *trx.transaction);
   }

}  // namespace

std::optional<SignedTransaction> SystemService::RTransact::next()
{
   check(getSender() == AccountNumber{}, "Wrong sender");
   auto unapplied    = WriteOnly{}.open<UnappliedTransactionTable>();
   auto reverify     = open<ReverifySignaturesTable>();
   auto nextSequence = unapplied.get({}).value_or(UnappliedTransactionRecord{0}).nextSequence;
   auto included     = Transact::Tables{Transact::service}.open<IncludedTrxTable>();
   std::optional<SignedTransaction> result;

   auto verifyId = open<VerifyIdTable>().get({}).value_or(VerifyIdRecord{}).verifyId;

   PSIBASE_SUBJECTIVE_TX
   {
      auto invalidated = reverify.get({}).value_or(ReverifySignaturesRecord{});
      if (invalidated.verifyId != verifyId)
      {
         flushTransactions(reverify, invalidated, verifyId);
      }
      nextSequence = std::max(nextSequence, invalidated.endSequence);
      auto table   = Subjective{}.open<PendingTransactionTable>();
      auto index   = table.getIndex<1>();
      for (auto iter = index.lower_bound(nextSequence), end = index.end(); iter != end; ++iter)
      {
         auto item    = *iter;
         nextSequence = item.sequence + 1;
         if (!included.get(std::tuple(item.expiration, item.id)))
         {
            auto trxData = Subjective{}.open<TransactionDataTable>();
            auto data    = trxData.get(item.id);
            check(!!data, "Internal error: missing transaction data");
            result = std::move(data->trx);
            break;
         }
      }
      unapplied.put({nextSequence});
      if (!result)
      {
         to<XTransact>().removeCallback(TransactionCallbackType::nextTransaction,
                                        MethodNumber{"next"});
      }
   }
   return result;
}

std::optional<std::vector<std::optional<RunToken>>> RTransact::preverify(
    psio::view<const SignedTransaction> trx)
{
   auto id = sha256(trx.transaction().data(), trx.transaction().size());
   PSIBASE_SUBJECTIVE_TX
   {
      if (auto pending = open<PendingTransactionTable>().get(id))
      {
         std::vector<std::optional<RunToken>> result;
         for (auto& token : pending->verifies)
         {
            result.push_back(std::move(token));
         }
         return result;
      }
   }
   return {};
}

namespace
{
   namespace refs
   {
      struct InnerTrace;
      struct Action
      {
         AccountNumber         sender;   ///< Account sending the action
         AccountNumber         service;  ///< Service to execute the action
         MethodNumber          method;   ///< Service method to execute
         std::span<const char> rawData;  ///< Data for the method
      };
      PSIO_REFLECT(Action, sender, service, method, rawData)

      struct ActionTrace
      {
         Action                          action;
         std::span<const char>           rawRetval;
         std::vector<InnerTrace>         innerTraces;
         std::chrono::nanoseconds        totalTime;
         std::optional<std::string_view> error;
      };
      PSIO_REFLECT(ActionTrace, action, rawRetval, innerTraces, totalTime, error)

      struct EventTrace
      {
         std::string_view      name;
         std::span<const char> data;
      };
      PSIO_REFLECT(EventTrace, name, data)

      struct ConsoleTrace
      {
         std::string_view console;
      };
      PSIO_REFLECT(ConsoleTrace, console)

      struct InnerTrace
      {
         std::variant<ConsoleTrace, EventTrace, ActionTrace> inner;
      };
      PSIO_REFLECT(InnerTrace, inner)

      struct TransactionTrace
      {
         std::vector<ActionTrace>        actionTraces;
         std::optional<std::string_view> error;
      };
      PSIO_REFLECT(TransactionTrace, actionTraces, error)
   }  // namespace refs
   using ActionRef           = refs::Action;
   using ActionTraceRef      = refs::ActionTrace;
   using EventTraceRef       = refs::EventTrace;
   using ConsoleTraceRef     = refs::ConsoleTrace;
   using InnerTraceRef       = refs::InnerTrace;
   using TransactionTraceRef = refs::TransactionTrace;

   struct PruneTrace
   {
      bool                            args = false;
      std::optional<std::string_view> operator()(psio::view<const std::optional<std::string>> msg)
      {
         if (msg)
         {
            return static_cast<std::string_view>(*msg);
         }
         else
         {
            return {};
         }
      }
      ActionRef operator()(psio::view<const Action> action)
      {
         return {
             .sender  = action.sender(),
             .service = action.service(),
             .method  = action.method(),
             .rawData = args ? action.rawData() : std::span<const char>{},
         };
      }
      auto operator()(psio::view<const ConsoleTrace> trace)
      {
         return ConsoleTraceRef{trace.console()};
      }
      auto operator()(psio::view<const EventTrace> trace)
      {
         return EventTraceRef{trace.name(), trace.data()};
      }
      auto operator()(psio::view<const ActionTrace> at)
      {
         ActionTraceRef pruned;
         pruned.error     = (*this)(at.error());
         pruned.totalTime = at.totalTime();
         pruned.rawRetval = at.rawRetval();
         pruned.action    = (*this)(at.action());
         pruned.innerTraces.reserve(at.innerTraces().size());
         for (const auto& inner : at.innerTraces())
         {
            pruned.innerTraces.push_back((*this)(inner));
         }
         return pruned;
      }
      InnerTraceRef operator()(psio::view<const InnerTrace> inner)
      {
         return psio::visit([this](const auto& trace) { return InnerTraceRef{(*this)(trace)}; },
                            inner.inner());
      }

      auto operator()(psio::view<const TransactionTrace> trace)
      {
         TransactionTraceRef pruned;
         pruned.error = (*this)(trace.error());
         pruned.actionTraces.reserve(trace.actionTraces().size());
         for (const auto& at : trace.actionTraces())
         {
            pruned.actionTraces.push_back((*this)(at));
         }
         return pruned;
      }
   };

   std::vector<RunToken> resolveVerifies(
       std::vector<UnverifiedTransactionRecord::VerifyStatus>&& tokens)
   {
      std::vector<RunToken> result;
      for (auto& token : tokens)
      {
         result.push_back(std::move(std::get<RunToken>(token)));
      }
      return result;
   }

   // Must be run in a subjective transaction
   void queueTransaction(const Checksum256&                                       id,
                         TimePointSec                                             expiration,
                         std::vector<UnverifiedTransactionRecord::VerifyStatus>&& verifies,
                         std::optional<std::uint64_t>                             speculative)
   {
      auto pending = RTransact{}.open<PendingTransactionTable>();
      // Find the next sequence number
      auto available = RTransact{}.open<AvailableSequenceTable>();
      auto sequence  = available.get({}).value_or(AvailableSequenceRecord{0}).nextSequence;
      available.put({sequence + 1});
      pending.put({.id         = id,
                   .expiration = expiration,
                   .ctime      = std::chrono::time_point_cast<psibase::Seconds>(
                       std::chrono::system_clock::now()),
                   .sequence    = sequence,
                   .verifies    = resolveVerifies(std::move(verifies)),
                   .speculative = speculative});

      // Tell native that we have a transaction
      to<XTransact>().addCallback(TransactionCallbackType::nextTransaction, MethodNumber{"next"});
      to<XTransact>().addCallback(TransactionCallbackType::preverifyTransaction,
                                  MethodNumber{"preverify"});
   }

   // Checks whether the set of verify services has changed
   // and flushes the transaction queue if they have.
   // Should be run at the end of a block.
   void checkReverify(const Checksum256& headId)
   {
      auto verifyIdTable = RTransact{}.open<VerifyIdTable>();
      auto verifySeq     = to<SetCode>().verifySeq();
      auto verifyId      = verifyIdTable.get({}).value_or(VerifyIdRecord{});
      if (verifyId.verifyCodeSequence != verifySeq)
      {
         verifyId = {verifySeq, headId};
         verifyIdTable.put(verifyId);
      }

      auto reverify = RTransact{}.open<ReverifySignaturesTable>();
      PSIBASE_SUBJECTIVE_TX
      {
         auto row = reverify.get({}).value_or(ReverifySignaturesRecord{});
         if (verifyId.verifyId != row.verifyId)
         {
            flushTransactions(reverify, row, verifyId.verifyId);
         }
      }
   }

   using ClientFilter = std::function<bool(const TraceClientInfo&)>;
   bool noFilter(const TraceClientInfo&)
   {
      return true;
   }

   // Returns a tuple containing:
   // 1. Vector of sockets waiting for a JSON response
   // 2. Vector of sockets waiting for a binary response
   //
   // Removes any clients from TraceClientTable for whom replies have been claimed.
   using ClaimedSockets = std::tuple<std::vector<std::int32_t>, std::vector<std::int32_t>>;
   auto claimClientReply(const psibase::Checksum256& id, const ClientFilter& clientFilter)
       -> ClaimedSockets
   {
      {
         auto                      clients = RTransact{}.open<TraceClientTable>();
         std::vector<std::int32_t> json_clients, bin_clients;

         auto socketClaimed = [&](const auto& client)
         {
            return std::ranges::contains(json_clients, client.socket) ||
                   std::ranges::contains(bin_clients, client.socket);
         };

         PSIBASE_SUBJECTIVE_TX
         {
            if (auto row_opt = clients.get(id))
            {
               auto& row = *row_opt;

               auto filtered = row.clients | std::views::filter(clientFilter);
               for (const auto& client : filtered)
               {
                  to<HttpServer>().claimReply(client.socket);
                  auto& clientList = client.json ? json_clients : bin_clients;
                  clientList.push_back(client.socket);
               }

               std::erase_if(row.clients, socketClaimed);

               if (row.clients.empty())
                  clients.remove(row);
               else
                  clients.put(row);
            }
         }

         return {std::move(json_clients), std::move(bin_clients)};
      }
   }

   struct FinalizedBlocks
   {
      psibase::BlockNum  first;  // First finalized block
      size_t             count;  // Number of finalized blocks
      psibase::BlockTime time;   // Time of the last finalized block
   };

   auto finalizeBlocks(const psibase::BlockHeader& head) -> std::optional<FinalizedBlocks>
   {
      auto commitNum  = head.commitNum;
      auto reversible = RTransact::WriteOnly{}.open<ReversibleBlocksTable>();
      reversible.put({.blockNum = head.blockNum, .time = head.time});

      BlockTime irreversibleTime = {};

      std::optional<FinalizedBlocks> result;
      for (auto r : reversible.getIndex<0>())
      {
         if (r.blockNum > commitNum)
            break;

         if (!result)
         {
            result = FinalizedBlocks{.first = r.blockNum, .count = 1, .time = r.time};
         }
         else
         {
            // Don't send responses for transactions in the current block,
            // because the client expects the results of the transaction
            // to be visible to queries, which doesn't happen till after onBlock.
            if (r.blockNum < head.blockNum)
               result->count++;
            result->time = r.time;
         }

         if (r.blockNum < commitNum)
         {
            // A block is irreversible if r.blockNum <= commitNum. The reason that the last
            // irreversible block is not removed here is so there will always be at least one
            // irreversible block to provide irreversibleTime.
            reversible.remove(r);
         }
      }

      return result;
   }

   void stopTracking(const std::vector<psibase::Checksum256>& txids)
   {
      auto pendingTxTable = RTransact::Subjective{}.open<PendingTransactionTable>();
      auto dataTable      = RTransact::Subjective{}.open<TransactionDataTable>();

      PSIBASE_SUBJECTIVE_TX
      {
         for (auto id : txids)
         {
            if (auto pending = pendingTxTable.get(id))
            {
               pendingTxTable.remove(*pending);
               cancelSpeculative(pending->speculative);
            }
            dataTable.erase(id);
         }
      }
   }

   void sendReply(const ClaimedSockets& clients, psio::view<const psibase::TransactionTrace> trace)
   {
      TransactionTraceRef pruned            = PruneTrace{true}(trace);
      const auto& [jsonClients, binClients] = clients;

      if (jsonClients.empty() && binClients.empty())  // failsafe
         return;

      ActionViewBuilder<HttpServer> http{getReceiver(), HttpServer::service};

      if (!jsonClients.empty())
      {
         JsonHttpReply<TransactionTraceRef&> reply{
             .contentType = "application/json", .body{pruned}, .headers = allowCors()};
         auto action = http.sendReply(0, reply);

         for (auto socket : jsonClients)
         {
            psio::get<0>(action->rawData().value()) = socket;
            call(action.data(), action.size());
         }
      }

      if (!binClients.empty())
      {
         FracpackHttpReply<TransactionTraceRef&> reply{
             .contentType = "application/octet-stream", .body{pruned}, .headers = allowCors()};
         auto action = http.sendReply(0, reply);

         for (auto socket : binClients)
         {
            psio::get<0>(action->rawData().value()) = socket;
            call(action.data(), action.size());
         }
      }
   }

   // This function should only be called for a transaction id that has clients waiting for it.
   void sendReply(const psibase::Checksum256&                 id,
                  psio::view<const psibase::TransactionTrace> trace,
                  const ClientFilter&                         clientFilter = noFilter)
   {
      sendReply(claimClientReply(id, clientFilter), trace);
   }

   void sendReplies(const std::vector<psibase::Checksum256>& txids)
   {
      auto successfulTxs = RTransact::WriteOnly{}.open<TxSuccessTable>();
      auto failedTxs     = RTransact::Subjective{}.open<TxFailedTable>();

      for (auto id : txids)
      {
         std::shared_ptr<void>                             traceStorage;
         std::optional<psio::view<const TransactionTrace>> traceView;

         if (auto tx = successfulTxs.getView(id))
         {
            traceView.emplace(tx->trace());
            successfulTxs.remove(*tx);
            traceStorage = std::move(tx).shared_data();
            PSIBASE_SUBJECTIVE_TX
            {
               // It is possible for a tx to have both failed and successful associated traces.
               // We want to prefer the successful result, so here we remove the failed trace
               //   (if it exists).
               failedTxs.erase(id);
            }
         }
         else
         {
            PSIBASE_SUBJECTIVE_TX
            {
               if (auto tx = failedTxs.getView(id))
               {
                  traceView.emplace(tx->trace());
                  failedTxs.remove(*tx);
                  traceStorage = std::move(tx).shared_data();
               }
            }
         }

         if (!traceView)
         {
            auto p = psio::shared_view_ptr<TransactionTrace>(
                TransactionTrace{.error = "Transaction expired"});
            traceView.emplace(*p);
            traceStorage = std::move(p).shared_data();
         }

         sendReply(id, *traceView);
      }

      stopTracking(txids);

#ifdef __wasm32__
      printf("memory usage: %lu\n", __builtin_wasm_memory_size(0) * 65536);
#endif
   }

   // Send failure traces for expired transactions. This is intended
   // to handle transactions that were not put in the queue. It should
   // be run after sending any successful traces, to avoid false positives.
   void sendFailureTraces(TxFailedTable& failed, BlockTime finalizedTime)
   {
      auto byExpiration = failed.getIndex<1>();

      while (true)
      {
         std::optional<std::vector<char>>                                 trace;
         std::tuple<std::vector<std::int32_t>, std::vector<std::int32_t>> claimed;
         PSIBASE_SUBJECTIVE_TX
         {
            if (auto iter = byExpiration.begin(); iter != byExpiration.end())
            {
               auto failedTx = *iter;
               if (failedTx.expiration <= finalizedTime)
               {
                  failed.remove(failedTx);
                  trace   = psio::to_frac(failedTx.trace);
                  claimed = claimClientReply(failedTx.id, noFilter);
               }
            }
         }
         if (trace)
         {
            auto traceView = psio::view<const TransactionTrace>{psio::prevalidated{*trace}};
            sendReply(claimed, traceView);
         }
         else
         {
            break;
         }
      }
   }

   struct WaitFor
   {
      std::string wait_for;

      static constexpr uint8_t final_flag   = 1;
      static constexpr uint8_t applied_flag = 2;

      [[nodiscard]] uint8_t flag() const
      {
         if (wait_for == "final")
            return final_flag;
         else if (wait_for == "applied")
            return applied_flag;
         else if (wait_for.empty())
            return final_flag;
         else
            psibase::abortMessage("Invalid wait_for parameter");
      }

      static bool isApplied(const TraceClientInfo& client)
      {
         return client.waitFor == WaitFor::applied_flag;
      }
      static bool isFinal(const TraceClientInfo& client)
      {
         return client.waitFor == WaitFor::final_flag;
      }
   };
   PSIO_REFLECT(WaitFor, wait_for)

   void cancelVerify(PendingVerifyTable& pendingVerifies, const UnverifiedTransactionRecord& tx)
   {
      for (const auto& v : tx.verifies)
      {
         if (auto* cancelId = std::get_if<std::uint64_t>(&v))
         {
            pendingVerifies.erase(*cancelId);
            to<XRun>().cancel(*cancelId, MethodNumber{"onVerify"});
         }
      }
   }

   void cancelSpeculative(const std::optional<std::uint64_t>& id)
   {
      auto speculative = RTransact{}.open<SpeculativeTransactionTable>();
      if (id)
      {
         speculative.erase(*id);
         to<XRun>().cancel(*id, MethodNumber{"onSpecTrx"});
      }
   }

}  // namespace

void RTransact::onTrx(const Checksum256& id, psio::view<const TransactionTrace> trace)
{
   check(getSender() == AccountNumber{}, "Wrong sender");
   printf("trace size: %zu\n", find_view_span(trace).size());

   auto clients = open<TraceClientTable>();

   bool waitForApplied = false;
   bool waitForFinal   = false;
   auto row            = std::optional<TraceClientRow>{};
   PSIBASE_SUBJECTIVE_TX
   {
      row = clients.get(id);
   }

   if (row)
   {
      waitForApplied = std::ranges::any_of(row->clients, WaitFor::isApplied);
      waitForFinal   = std::ranges::any_of(row->clients, WaitFor::isFinal);
   }

   if (waitForFinal)
   {
      if (!trace.error().has_value())
      {
         WriteOnly{}.open<TxSuccessTable>().put(TxSuccessView{
             .id       = id,
             .blockNum = to<Transact>().currentBlock().blockNum,
             .trace    = trace,
         });
      }
      else
      {
         PSIBASE_SUBJECTIVE_TX
         {
            Subjective{}.open<TxFailedTable>().put(TxFailedView{
                .id         = id,
                .expiration = row->expiration,
                .trace      = trace,
            });
         }
      }
   }

   if (waitForApplied)
   {
      sendReply(id, trace, WaitFor::isApplied);
   }
#ifdef __wasm32__
   printf("memory usage: %lu\n", __builtin_wasm_memory_size(0) * 65536);
#endif
}

void RTransact::onBlock()
{
   check(getSender() == AccountNumber{}, "Wrong sender");
   auto stat = psibase::kvGet<psibase::StatusRow>(psibase::StatusRow::db, psibase::statusKey());
   check(stat && stat->head, "Head block should be set before calling onBlock");

   checkReverify(stat->head->blockId);

   auto finalized = finalizeBlocks(stat->head->header);
   if (!finalized)
      return;

   // Reasons to send a reply:
   // 1. The transaction was successful and is irreversible
   // 2. The transaction is expired

   // On failed transactions: We cannot send a response until the transaction
   // has expired (Implicit consensus that the tx will not be included).

   // In all cases where a reply is sent, we can stop subjectively tracking information about that tx
   //
   // To determine the trace for the reply, the txid can be used to look up the trace in subjective tables.
   //   If there is no record of that tx in the table, then it must be an expired pending transaction so
   //   it gets the standard "transaction expired" trace.

   std::vector<psibase::Checksum256> txids;

   auto successfulTxTable = WriteOnly{}.open<TxSuccessTable>();
   auto failedTxTable     = Subjective{}.open<TxFailedTable>();
   auto pendingTxTable    = Subjective{}.open<PendingTransactionTable>();
   auto dataTable         = Subjective{}.open<TransactionDataTable>();
   auto clientTable       = open<TraceClientTable>();

   // Get all successful and irreversible transactions
   auto successTxIdx = successfulTxTable.getIndex<1>();
   for (BlockNum blockNum : std::views::iota(finalized->first) | std::views::take(finalized->count))
   {
      for (const auto& tx : successTxIdx.subindex<psibase::Checksum256>(blockNum))
      {
         txids.push_back(tx.id);
      }
   }

   PSIBASE_SUBJECTIVE_TX
   {
      // Get all expired transactions
      for (auto pendingTx : pendingTxTable.getIndex<3>())
      {
         if (pendingTx.expiration > finalized->time)
            break;

         txids.push_back(pendingTx.id);
      }
   }

   // Ensure all txids have a client waiting for a reply
   std::vector<psibase::Checksum256> needsReply;
   for (auto id : txids)
   {
      PSIBASE_SUBJECTIVE_TX
      {
         if (auto client = clientTable.get(id))
         {
            needsReply.push_back(id);
         }
         else
         {  // Stop tracking a finalized tx if no client is waiting for a reply.
            if (auto pending = pendingTxTable.get(id))
            {
               pendingTxTable.remove(*pending);
               cancelSpeculative(pending->speculative);
            }
            dataTable.erase(id);

            successfulTxTable.erase(id);
            failedTxTable.erase(id);
         }
      }
   }

   sendReplies(needsReply);
   sendFailureTraces(failedTxTable, finalized->time);
}

void RTransact::onVerify(std::uint64_t                      id,
                         psio::view<const TransactionTrace> trace,
                         std::optional<RunToken>            token)
{
   check(getSender() == AccountNumber{}, "Wrong sender");
   auto pendingVerifies        = open<PendingVerifyTable>();
   auto unverifiedTransactions = open<UnverifiedTransactionTable>();
   auto reverify               = open<ReverifySignaturesTable>();
   auto clients                = open<TraceClientTable>();
   auto runVerifyId            = open<VerifyIdTable>().get({}).value_or(VerifyIdRecord{}).verifyId;
   auto errorTxId              = std::optional<Checksum256>{};
   auto broadcastTxId          = std::optional<Checksum256>{};
   PSIBASE_SUBJECTIVE_TX
   {
      to<XRun>().finish(id);
      if (auto row = pendingVerifies.get(id))
      {
         pendingVerifies.remove(*row);
         auto tx = unverifiedTransactions.get(row->txid);
         check(tx.has_value(), "Missing unverified transaction");
         bool ready = true;
         for (auto& v : tx->verifies)
         {
            if (auto* vid = std::get_if<std::uint64_t>(&v))
            {
               if (*vid == id)
                  v = std::move(token.value());
               else
                  ready = false;
            }
         }
         auto headVerifyId = reverify.get({}).value_or(ReverifySignaturesRecord{}).verifyId;
         if (tx->verifyId == Checksum256{})
            tx->verifyId = runVerifyId;
         bool prevVerified = tx->verified;
         tx->verified |= ready;
         if (!trace.error() && headVerifyId == tx->verifyId && tx->verifyId == runVerifyId)
         {
            if (ready)
            {
               if (!prevVerified && !tx->speculative)
                  broadcastTxId = tx->id;
               queueTransaction(tx->id, tx->expiration, std::move(tx->verifies), tx->speculative);
               unverifiedTransactions.remove(*tx);
            }
            else
            {
               unverifiedTransactions.put(*tx);
            }
         }
         else
         {
            cancelVerify(pendingVerifies, *tx);
            if (trace.error())
            {
               unverifiedTransactions.remove(*tx);
               cancelSpeculative(tx->speculative);
               open<TransactionDataTable>().erase(tx->id);
               if (auto client = clients.get(tx->id))
               {
                  if (std::ranges::any_of(client->clients, WaitFor::isFinal))
                  {
                     Subjective{}.open<TxFailedTable>().put(TxFailedView{
                         .id         = tx->id,
                         .expiration = tx->expiration,
                         .trace      = trace,
                     });
                  }
                  if (std::ranges::any_of(client->clients, WaitFor::isApplied))
                     errorTxId = tx->id;
               }
            }
            else
            {
               auto data = open<TransactionDataTable>().get(tx->id);
               check(data.has_value(), "Missing transaction data");
               scheduleVerify(tx->id, data->trx, tx->verified, tx->speculative);
            }
         }
      }
   }
   if (errorTxId)
   {
      sendReply(*errorTxId, trace, WaitFor::isApplied);
   }
   if (broadcastTxId)
   {
      std::optional<TransactionData> data;
      PSIBASE_SUBJECTIVE_TX
      {
         data = open<TransactionDataTable>().get(*broadcastTxId);
      }
      if (data)
      {
         forwardTransaction(data->trx);
      }
   }
}

void RTransact::onRequeue(std::uint64_t id, psio::view<const TransactionTrace> trace)
{
   check(getSender() == AccountNumber{}, "Wrong sender");
   PSIBASE_SUBJECTIVE_TX
   {
      to<XRun>().finish(id);
   }
}

void RTransact::onSpecTrx(std::uint64_t id, psio::view<const TransactionTrace> trace)
{
   check(getSender() == AccountNumber{}, "Wrong sender");
   auto                       speculative = open<SpeculativeTransactionTable>();
   auto                       unverified  = open<UnverifiedTransactionTable>();
   auto                       pending     = open<PendingTransactionTable>();
   auto                       clients     = open<TraceClientTable>();
   std::optional<Checksum256> errorTxId;
   std::optional<Checksum256> broadcastTxId;
   PSIBASE_SUBJECTIVE_TX
   {
      to<XRun>().finish(id);
      if (auto row = speculative.get(id))
      {
         speculative.remove(*row);

         if (!trace.error().has_value())
         {
            if (auto trx = unverified.get(row->txid))
            {
               check(trx->speculative.has_value(), "Missing speculative runid in unverified");
               check(*trx->speculative == id,
                     "Wrong runid for speculative transaction in unverified");
               trx->speculative.reset();
               unverified.put(*trx);
               if (trx->verified)
                  broadcastTxId = trx->id;
            }
            else if (auto trx = pending.get(row->txid))
            {
               check(trx->speculative.has_value(), "Missing speculative runid in pending");
               check(*trx->speculative == id, "Wrong runid for speculative transaction in pening");
               trx->speculative.reset();
               pending.put(*trx);
               broadcastTxId = trx->id;
            }
            else
            {
               check(false,
                     "Speculative execution should be cancelled when a transaction is dropped");
            }
         }
         else
         {
            TimePointSec expiration;
            if (auto trx = unverified.get(row->txid))
            {
               unverified.remove(*trx);
               auto pending = open<PendingVerifyTable>();
               cancelVerify(pending, *trx);
               open<TransactionDataTable>().erase(trx->id);
               expiration = trx->expiration;
            }
            else if (auto trx = pending.get(row->txid))
            {
               pending.remove(*trx);
               expiration = trx->expiration;
            }
            else
            {
               check(false,
                     "Speculative execution should be cancelled when a transaction is dropped");
            }
            open<TransactionDataTable>().erase(row->txid);
            if (auto client = clients.get(row->txid))
            {
               if (std::ranges::any_of(client->clients, WaitFor::isApplied))
                  errorTxId = row->txid;
               if (std::ranges::any_of(client->clients, WaitFor::isFinal))
               {
                  open<TxFailedTable>().put({
                      .id         = row->txid,
                      .expiration = expiration,
                      .trace      = trace.unpack(),
                  });
               }
            }
         }
      }
   }
   if (errorTxId)
   {
      sendReply(*errorTxId, trace, WaitFor::isApplied);
   }
   if (broadcastTxId)
   {
      std::optional<TransactionData> data;
      PSIBASE_SUBJECTIVE_TX
      {
         data = open<TransactionDataTable>().get(*broadcastTxId);
      }
      if (data)
      {
         forwardTransaction(data->trx);
      }
   }
}

namespace
{
   using Subjective = RTransact::Subjective;
   using WriteOnly  = RTransact::WriteOnly;

   std::uint64_t scheduleSpeculative(const Checksum256& id, const SignedTransaction& trx)
   {
      transactor<Transact> transact{RTransact::service, Transact::service};
      auto runid = to<XRun>().post(RunMode::speculative, transact.execTrx(trx.transaction, true),
                                   std::chrono::seconds(1), MethodNumber{"onSpecTrx"});
      RTransact{}.open<SpeculativeTransactionTable>().put({id, runid});
      return runid;
   }

   // Must be run inside PSIBASE_SUBJECTIVE_TX
   void scheduleVerify(const Checksum256&           id,
                       const SignedTransaction&     trx,
                       bool                         verified,
                       std::optional<std::uint64_t> speculative)
   {
      auto pendingVerifies        = RTransact{}.open<PendingVerifyTable>();
      auto unverifiedTransactions = RTransact{}.open<UnverifiedTransactionTable>();

      std::vector<UnverifiedTransactionRecord::VerifyStatus> remaining;

      auto claims = trx.transaction->claims();
      check(claims.size() == trx.proofs.size(), "Claims and proofs must have the same size");
      for (auto&& [claim, proof] : std::views::zip(claims, trx.proofs))
      {
         auto runid = to<XRun>().verify(id, claim, proof, std::chrono::milliseconds(200),
                                        MethodNumber{"onVerify"});
         remaining.push_back(runid);
         pendingVerifies.put({.txid = id, .runid = runid});
      }
      if (claims.empty())
      {
         queueTransaction(id, trx.transaction->tapos().expiration(), std::move(remaining),
                          speculative);
      }
      else
      {
         UnverifiedTransactionRecord row{
             .id          = id,
             .expiration  = trx.transaction->tapos().expiration(),
             .verifies    = std::move(remaining),
             .verified    = verified,
             .speculative = speculative,
         };
         unverifiedTransactions.put(row);
      }
   }

   bool pushTransaction(const Checksum256& id, const SignedTransaction& trx, bool speculate)
   {
      PSIBASE_SUBJECTIVE_TX
      {
         auto pending = Subjective{}.open<PendingTransactionTable>();
         if (pending.get(id))
         {
            return false;
         }
         auto unverified = RTransact{}.open<UnverifiedTransactionTable>();
         if (auto row = unverified.get(id))
         {
            return false;
         }
         auto speculative = speculate ? std::optional{scheduleSpeculative(id, trx)} : std::nullopt;
         scheduleVerify(id, trx, false, speculative);
         Subjective{}.open<TransactionDataTable>().put({id, std::move(trx)});
      }
      if (!speculate && trx.transaction->claims().empty())
      {
         forwardTransaction(trx);
      }
      return true;
   }
   void forwardTransaction(const SignedTransaction& trx)
   {
      to<HttpServer>().sendProds(
          transactor<RTransact>(HttpServer::service, RTransact::service).recv(trx));
   }

   constexpr auto ws = " \t";  // (SP / HTAB)

   std::string_view trim(std::string_view s)
   {
      auto low  = s.find_first_not_of(ws);
      auto high = s.find_last_not_of(ws);
      if (low == std::string::npos)
         return {};
      else
         return s.substr(low, high - low + 1);
   }

   template <typename F>
   void parseHeader(std::string_view value, F&& f)
   {
      for (auto&& part : value | std::views::split(','))
      {
         f(trim(std::string_view(part.begin(), part.end())));
      }
   }

   std::optional<int> parseQ(std::string_view param)
   {
      if (param.starts_with("q="))
      {
         int q;
         param.remove_prefix(2);
         if (param.starts_with('0'))
            q = 0;
         else if (param.starts_with('1'))
            q = 1000;
         else
            return {};
         if (param.size() > 1)
         {
            if (param[1] != '.')
               return {};
            param.remove_prefix(2);
            if (param.size() > 3)
               return {};
            for (std::size_t i = 0; i < 3; ++i)
            {
               int digit = 0;
               if (i < param.size())
               {
                  auto ch = param[i];
                  if (ch < '0' || ch > '9')
                     return {};
                  digit = ch - '0';
               }
               q = q * 10 + digit;
            }
            if (q > 1000)
               return {};
         }
         return q;
      }
      return {};
   }

   struct AcceptParser
   {
      int  bestJson = -1;
      int  bestBin  = -1;
      int  jsonQ    = 0;
      int  binQ     = 0;
      void operator()(std::string_view value)
      {
         bool first        = true;
         int  q            = 1000;
         int  specificness = -1;
         bool json         = false;
         bool bin          = false;
         for (auto&& part : value | std::views::split(';'))
         {
            auto param = trim(std::string_view(part.begin(), part.end()));
            if (first)
            {
               first = false;
               if (param == "application/json")
               {
                  json         = true;
                  specificness = 2;
               }
               else if (param == "application/octet-stream")
               {
                  bin          = true;
                  specificness = 2;
               }
               else if (param == "application/*")
               {
                  json         = true;
                  bin          = true;
                  specificness = 1;
               }
               else if (param == "*/*")
               {
                  json         = true;
                  bin          = true;
                  specificness = 0;
               }
               else
               {
                  return;
               }
            }
            else
            {
               if (auto newQ = parseQ(param))
               {
                  q = *newQ;
               }
            }
         }
         if (json && specificness > bestJson)
         {
            bestJson = specificness;
            jsonQ    = q;
         }
         if (bin && specificness > bestBin)
         {
            bestBin = specificness;
            binQ    = q;
         }
      }
      bool isJson() { return jsonQ >= binQ; }
   };

   bool acceptJson(const auto& headers)
   {
      AcceptParser parser;
      for (const auto& header : headers)
      {
         if (std::ranges::equal(header.name | std::views::transform(::tolower),
                                std::string_view("accept")))
         {
            parseHeader(header.value, parser);
         }
      }
      return parser.isJson();
   }

   struct LoginData
   {
      std::string rootHost;
   };
   PSIO_REFLECT(LoginData, rootHost)

   struct LoginTokenData
   {
      AccountNumber sub;
      std::string   aud;
      std::int64_t  exp;
   };
   PSIO_REFLECT(LoginTokenData, sub, aud, exp)

   struct LoginReply
   {
      std::string access_token;
      std::string token_type = "bearer";
   };
   PSIO_REFLECT(LoginReply, access_token, token_type)

   std::vector<char> getJWTKey()
   {
      std::optional<JWTKeyRecord> row;
      PSIBASE_SUBJECTIVE_TX
      {
         auto table = Subjective{}.open<JWTKeyTable>();
         auto index = table.getIndex<0>();
         row        = index.get({});
         if (!row)
         {
            char buf[16];
            raw::getRandom(buf, sizeof(buf));
            row = JWTKeyRecord{std::vector(buf, buf + sizeof(buf))};
            table.put(*row);
         }
      }
      return std::move(row->key);
   }

   bool checkExp(TimePointSec exp)
   {
      auto now =
          std::chrono::time_point_cast<std::chrono::seconds>(std::chrono::system_clock::now());
      return now <= exp;
   }

   bool checkExp(std::int64_t exp)
   {
      return checkExp(TimePointSec{std::chrono::seconds{exp}});
   }

   template <typename T>
   T parseBody(const psibase::HttpRequest& request)
   {
      T result;
      if (request.contentType == "application/json")
      {
         std::vector<char> body;
         body.reserve(request.body.size() + 1);
         body.insert(request.body.end(), request.body.begin(), request.body.end());
         body.push_back('\0');
         psio::json_token_stream stream(body.data());
         from_json(result, stream);
      }
      else if (request.contentType == "application/octet-stream")
      {
         psio::input_stream stream{request.body};
         from_frac(result, stream);
      }
      else
      {
         abortMessage("Expected a json or fracpack body");
      }
      return result;
   }

}  // namespace

void RTransact::requeue()
{
   auto          reverify          = RTransact{}.open<ReverifySignaturesTable>();
   auto          txdata            = RTransact{}.open<TransactionDataTable>();
   auto          pending           = RTransact{}.open<PendingTransactionTable>();
   auto          pendingBySequence = pending.getIndex<1>();
   std::uint64_t nextSequence      = 0;
   std::uint64_t endSequence;
   while (true)
   {
      PSIBASE_SUBJECTIVE_TX
      {
         auto row    = reverify.get({}).value_or(ReverifySignaturesRecord{});
         endSequence = row.endSequence;
         if (nextSequence >= endSequence)
         {
            row.running = false;
            reverify.put(row);
         }
      }
      if (nextSequence >= endSequence)
         break;
      while (true)
      {
         PSIBASE_SUBJECTIVE_TX
         {
            auto iter = pendingBySequence.lower_bound(nextSequence);
            auto item = *iter;
            if (item.sequence < endSequence)
            {
               auto data = txdata.get(item.id);
               check(!!data, "Missing transaction data");

               pending.remove(item);

               scheduleVerify(item.id, data->trx, true, item.speculative);
            }
            nextSequence = item.sequence + 1;
         }
         if (nextSequence >= endSequence)
            break;
      }
   }
}

void RTransact::recv(const SignedTransaction& trx)
{
   check(getSender() == HttpServer::service, "Wrong sender");
   auto id          = psibase::sha256(trx.transaction.data(), trx.transaction.size());
   bool enforceAuth = validateTransaction(id, trx);
   pushTransaction(id, trx, enforceAuth);
}

std::string RTransact::login(std::string rootHost)
{
   auto sender = getSender();
   auto exp = std::chrono::time_point_cast<std::chrono::seconds>(std::chrono::system_clock::now() +
                                                                 std::chrono::days(30));
   return encodeJWT(getJWTKey(), LoginTokenData{.sub = sender,
                                                .aud = std::move(rootHost),
                                                .exp = exp.time_since_epoch().count()});
}

std::optional<AccountNumber> RTransact::getUser(HttpRequest request)
{
   std::vector<char>            key = getJWTKey();
   std::optional<AccountNumber> result;
   bool                         isLocalhost = psibase::isLocalhost(request);
   for (const auto& header : request.headers)
   {
      if (std::ranges::equal(header.name, std::string_view{"authorization"}, {}, ::tolower))
      {
         parseHeader(header.value,
                     [&](std::string_view value)
                     {
                        std::string_view prefix = "Bearer ";
                        if (value.starts_with(prefix))
                        {
                           auto token   = value.substr(prefix.size());
                           auto decoded = decodeJWT<LoginTokenData>(key, token);
                           if (decoded.aud == request.rootHost && checkExp(decoded.exp))
                           {
                              result = decoded.sub;
                           }
                        }
                     });
         if (result)
            return result;
      }
   }

   std::string_view cookieName = isLocalhost ? "SESSION" : "__Host-SESSION";

   auto tokens = request.getCookie(cookieName);
   for (const auto& token : tokens)
   {
      auto decoded = decodeJWT<LoginTokenData>(key, token);
      if (decoded.aud == request.rootHost && checkExp(decoded.exp))
         return decoded.sub;
   }
   return {};
}

struct SnapInfo
{
   psibase::BlockTime lastSnapshot;
   uint32_t           snapshotInterval;
};
PSIO_REFLECT(SnapInfo, lastSnapshot, snapshotInterval);

struct TransactQuery
{
   auto snapshotInfo() const -> std::optional<SnapInfo>
   {
      auto snapInfo = Transact::Tables{Transact::service}.open<SnapshotInfoTable>().get({});
      if (snapInfo.has_value())
      {
         auto count = snapInfo->snapshotInterval.count();
         check(count >= 0 && static_cast<uint64_t>(count) <= std::numeric_limits<uint32_t>::max(),
               "snapshotInterval out of range");
         auto ret = SnapInfo{.lastSnapshot     = snapInfo->lastSnapshot,
                             .snapshotInterval = static_cast<uint32_t>(count)};
         return std::optional<SnapInfo>{std::move(ret)};
      }

      return {};
   }
};
PSIO_REFLECT(TransactQuery, method(snapshotInfo));

std::optional<HttpReply> RTransact::serveSys(const psibase::HttpRequest&  request,
                                             std::optional<std::int32_t>  socket,
                                             std::optional<AccountNumber> user)
{
   check(getSender() == HttpServer::service, "Wrong sender");
   check(socket.has_value(), "Missing socket");
   auto target = request.path();
   if (target == "/push_transaction")
   {
      if (request.method == "OPTIONS")
         return HttpReply{.headers = allowCorsSubdomains(request)};
      if (request.method != "POST")
      {
         auto message = std::format("The resouce '{}' does not accept the method {}.",
                                    request.target, request.method);
         auto headers = allowCorsSubdomains(request);
         headers.push_back({"Allow", "POST, OPTIONS"});
         return HttpReply{
             .status      = HttpStatus::methodNotAllowed,
             .contentType = "text/html",
             .body{message.begin(), message.end()},
             .headers = std::move(headers),
         };
      }
      if (request.contentType != "application/octet-stream")
         abortMessage("Expected fracpack encoded signed transaction (application/octet-stream)");

      auto query       = request.query<WaitFor>();
      auto trx         = psio::from_frac<SignedTransaction>(request.body);
      auto id          = psibase::sha256(trx.transaction.data(), trx.transaction.size());
      bool enforceAuth = validateTransaction(id, trx);
      bool json        = acceptJson(request.headers);
      PSIBASE_SUBJECTIVE_TX
      {
         auto clients = open<TraceClientTable>();
         auto row     = clients.get(id).value_or(
             TraceClientRow{.id = id, .expiration = trx.transaction->tapos().expiration()});
         row.clients.push_back({*socket, json, query.flag()});
         clients.put(row);
         to<HttpServer>().deferReply(*socket);
      }
      pushTransaction(id, trx, enforceAuth);
   }
   else if (request.method == "POST" && target == "/login")
   {
      auto trx = parseBody<SignedTransaction>(request);
      check(trx.transaction->actions().size() == 1 &&
                trx.transaction->actions()[0].method() == MethodNumber{"loginSys"},
            "Expected a login transaction");
      check(trx.transaction->tapos().flags() & Tapos::do_not_broadcast_flag,
            "Login transaction must be do_not_broadcast");
      auto loginAct = trx.transaction->actions()[0];
      auto sender   = loginAct.sender().unpack();
      auto app      = loginAct.service().unpack();
      auto data     = psio::from_frac<LoginData>(loginAct.rawData());
      if (checkExp(trx.transaction->tapos().expiration()) && data.rootHost == request.rootHost)
      {
         // verify signatures
         auto claims = trx.transaction->claims();
         if (claims.size() != trx.proofs.size())
            abortMessage("Proofs and claims must have the same size");
         for (std::size_t i = 0; i < trx.proofs.size(); ++i)
         {
            Actor<VerifyInterface> verify(RTransact::service, claims[i].service());
            verify.verifySys(sha256(trx.transaction.data(), trx.transaction.size()), claims[i],
                             trx.proofs[i]);
         }
         // check auth
         auto accountsTables = Accounts::Tables(Accounts::service);
         auto accountTable   = accountsTables.open<AccountTable>();
         auto accountIndex   = accountTable.getIndex<0>();
         auto account        = accountIndex.get(sender);
         check(!!account, "Account not found");
         Actor<AuthInterface> auth(RTransact::service, account->authService);
         auto                 flags = AuthInterface::topActionReq | AuthInterface::firstAuthFlag;
         auth.checkAuthSys(flags, psibase::AccountNumber{}, sender,
                           ServiceMethod{AccountNumber{}, MethodNumber{}},
                           std::vector<ServiceMethod>{}, claims);
         // Construct token
         auto exp = std::chrono::time_point_cast<std::chrono::seconds>(
             std::chrono::system_clock::now() + std::chrono::days(30));
         auto                token = encodeJWT(getJWTKey(), LoginTokenData{.sub = sender,
                                                                           .aud = request.rootHost,
                                                                           .exp = exp.time_since_epoch().count()});
         HttpReply           reply{.contentType = "application/json",
                                   .headers     = allowCors(request, AccountNumber{"supervisor"})};
         psio::vector_stream stream{reply.body};
         to_json(LoginReply{token}, stream);
         return reply;
      }
   }
   else if (target == "/jwt_key" && request.method == "GET")
   {
      check(user.has_value(), "Unauthorized");
      check(to<XAdmin>().isAdmin(*user), "Forbidden");
      return HttpReply{.contentType = "application/octet-stream",
                       .body        = getJWTKey(),
                       .headers     = allowCors(request, AccountNumber{"supervisor"})};
   }
   else if (auto result = serveGraphQL(request, TransactQuery{}))
      return result;

   return {};
}

PSIBASE_DISPATCH(RTransact)
