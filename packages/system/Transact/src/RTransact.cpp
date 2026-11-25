#include <services/local/XAdmin.hpp>
#include <services/local/XRun.hpp>
#include <services/local/XTransact.hpp>
#include <services/system/Accounts.hpp>
#include <services/system/HttpServer.hpp>
#include <services/system/RTransact.hpp>
#include <services/system/SetCode.hpp>
#include <services/system/Transact.hpp>
#include <services/system/VirtualServer.hpp>

#include <functional>
#include <psibase/HttpHeaders.hpp>
#include <psibase/Rpc.hpp>
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
   void scheduleVerify(const Checksum256&                 id,
                       psio::pssz_view<SignedTransaction> trx,
                       bool                               verified,
                       std::optional<std::uint64_t>       speculative);

   void cancelSpeculative(const std::optional<std::uint64_t>& id);
   void forwardTransaction(psio::pssz_view<SignedTransaction> trx);
   void forwardStoredTransaction(const Checksum256& id);

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

   bool validateTransaction(const Checksum256& id, psio::pssz_view<SignedTransaction> trx)
   {
      check(trx.transaction()->claims().size() == trx.proofs().size(),
            "proofs and claims must have same size");
      return to<Transact>().checkFirstAuth(id, *trx.transaction());
   }

   bool isResMonitoring()
   {
      auto table  = Transact{}.open<ResMonitoringConfigTable>(KvMode::read);
      auto config = table.get({});
      return config && config->enabled;
   }
}  // namespace

std::optional<SignedTransaction> SystemService::RTransact::next()
{
   check(getSender() == AccountNumber{}, "Wrong sender");
   if (isResMonitoring())
   {
      if (!to<VirtualServer>().can_push_tx())
      {
         return {};
      }
   }
   else
   {
      // Soft limit for boot blocks (hard limit imposed by native storage
      // is 16 MiB for the packed block)
      constexpr std::uint32_t blockLimit = 8 * 1024 * 1024;
      if (auto sizeRow = open<BlockSizeTable>().get({}))
      {
         if (sizeRow->currentBlockSize >= blockLimit)
         {
            return {};
         }
      }
   }
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
    psio::pssz_view<SignedTransaction> trx)
{
   auto id = sha256(trx.transaction().bytes().data(), trx.transaction().bytes().size());
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

      struct ConsoleTrace
      {
         std::string_view console;
      };
      PSIO_REFLECT(ConsoleTrace, console)

      struct InnerTrace
      {
         std::variant<ConsoleTrace, ActionTrace> inner;
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
   using ConsoleTraceRef     = refs::ConsoleTrace;
   using InnerTraceRef       = refs::InnerTrace;
   using TransactionTraceRef = refs::TransactionTrace;

   struct PruneTrace
   {
      bool                            args = false;
      std::optional<std::string_view> operator()(psio::pssz_view<std::optional<std::string>> msg)
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
      ActionRef operator()(psio::pssz_view<Action> action)
      {
         return {
             .sender  = action.sender(),
             .service = action.service(),
             .method  = action.method(),
             .rawData = args ? action.rawData() : std::span<const char>{},
         };
      }
      auto operator()(psio::pssz_view<ConsoleTrace> trace)
      {
         return ConsoleTraceRef{trace.console()};
      }
      auto operator()(psio::pssz_view<ActionTrace> at)
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
      InnerTraceRef operator()(psio::pssz_view<InnerTrace> inner)
      {
         return inner.inner().visit([this](const auto& trace)
                                    { return InnerTraceRef{(*this)(trace)}; });
      }

      auto operator()(psio::pssz_view<TransactionTrace> trace)
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

   // A trace repeats the arguments of every action, so the trace of a
   // large transaction is larger than the transaction. A trace above this
   // size, packed, is neither kept nor sent: reducedTrace stands for it.
   // The size leaves room for the row (ConfigRow's maxValueSize, 8 MiB)
   // and for the reply. The JSON text of a trace is 2 to 2.3 times its
   // bytes (hex for large arguments; member names for many small actions).
   // This service writes the text into the action that sends it and holds
   // 3 to 4.2 times the trace; what bounds a reply now is http-server and
   // x-http, which each hold the text three times in their 32 MiB.
   // Measured, a trace of 4.55 MiB of many small actions is answered and
   // one of 4.65 MiB is not; with one large argument, 5.21 and 5.31 MiB
   // (doc/pssz-conversion.md 7.12).
   constexpr std::size_t maxFullTraceSize = 13 * 1024 * 1024 / 4;

   bool isFullSize(psio::pssz_view<TransactionTrace> trace)
   {
      return psio::bytes(trace).size() <= maxFullTraceSize;
   }

   // What is kept and sent in place of a trace that is too large: its
   // outcome (the error, or none), and one action trace, in the name of
   // this service, whose console output says where the rest went. A client
   // reads the outcome as from any trace.
   TransactionTrace reducedTrace(psio::pssz_view<TransactionTrace> trace)
   {
      TransactionTrace result;
      auto&            note = result.actionTraces.emplace_back();
      note.action.sender    = RTransact::service;
      note.action.service   = RTransact::service;
      note.innerTraces.push_back({ConsoleTrace{
          std::format("The trace of this transaction is {} bytes packed, more than the {} that {} "
                      "keeps and sends: its action traces are omitted.",
                      psio::bytes(trace).size(), maxFullTraceSize, RTransact::service.str())}});
      if (auto error = trace.error())
         result.error = std::string{static_cast<std::string_view>(*error)};
      return result;
   }

   void putFailed(const Checksum256&                id,
                  TimePointSec                      expiration,
                  psio::pssz_view<TransactionTrace> trace)
   {
      auto table = RTransact::Subjective{}.open<TxFailedTable>();
      if (isFullSize(trace))
         table.put(TxFailedView{.id = id, .expiration = expiration, .trace = trace});
      else
         table.put(
             TxFailedRecord{.id = id, .expiration = expiration, .trace = reducedTrace(trace)});
   }

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

   void incFailedCount()
   {
      auto statsTable = RTransact::Subjective{}.open<TxStatsTable>();
      auto stats      = statsTable.get({}).value_or(TxStatsRecord{});
      ++stats.failed;

      --stats.unprocessed;
      statsTable.put(stats);
   }

   void stopTracking(const std::vector<psibase::Checksum256>& txids, TxStatsRecord statsDelta)
   {
      auto pendingTxTable = RTransact::Subjective{}.open<PendingTransactionTable>();
      auto dataTable      = RTransact::Subjective{}.open<TransactionDataTable>();
      auto statsTable     = RTransact::Subjective{}.open<TxStatsTable>();

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
         auto stats = statsTable.get({}).value_or(TxStatsRecord{});
         stats.unprocessed -= txids.size();
         stats.succeeded += statsDelta.succeeded;
         stats.failed += statsDelta.failed;
         stats.expired += statsDelta.expired;
         statsTable.put(stats);
      }
   }

   void sendReply(const ClaimedSockets& clients, psio::pssz_view<psibase::TransactionTrace> trace)
   {
      const auto& [jsonClients, binClients] = clients;

      if (jsonClients.empty() && binClients.empty())  // failsafe
         return;

      if (!isFullSize(trace))
      {
         auto reduced = psio::to_pssz(reducedTrace(trace));
         return sendReply(clients, psio::pssz_view<TransactionTrace>{reduced});
      }

      TransactionTraceRef pruned = PruneTrace{true}(trace);

      ActionViewBuilder<HttpServer> http{getReceiver(), HttpServer::service};

      // The action is packed once; the socket, its first argument, is
      // overwritten in place for each client.
      // The reply is an HttpReply or a source of one.
      auto send = [&](const auto& reply, const std::vector<std::int32_t>& sockets)
      {
         auto action = http.sendReply(0, reply);
         auto args   = *psio::as_mutable_view(action).rawData();
         for (auto socket : sockets)
         {
            args.template get<0>() = socket;
            call(action.data(), action.size());
         }
      };

      if (!jsonClients.empty())
      {
         // The body is the JSON text of the trace, written into the action:
         // the text is measured (check) and never has a buffer of its own.
         // A trace may hold a string with no JSON text (an abort message that
         // is not UTF-8): the clients are told so rather than left waiting.
         auto body = psio::ijson_of(pruned);
         if (body.check().ok())
         {
            send(BasicHttpReply<decltype(body)>{.contentType = "application/json",
                                                .body        = std::move(body),
                                                .headers     = allowCors()},
                 jsonClients);
         }
         else
         {
            std::string_view msg = "The transaction trace has no JSON text";
            send(HttpReply{.status      = HttpStatus::internalServerError,
                           .contentType = "text/plain",
                           .body        = std::vector(msg.begin(), msg.end()),
                           .headers     = allowCors()},
                 jsonClients);
         }
      }

      if (!binClients.empty())
      {
         // The body is the packed trace, written into the action from the
         // views it is made of.
         auto body = psio::packed(pruned);
         send(BasicHttpReply<decltype(body)>{.contentType = "application/octet-stream",
                                             .body        = std::move(body),
                                             .headers     = allowCors()},
              binClients);
      }
   }

   // This function should only be called for a transaction id that has clients waiting for it.
   void sendReply(const psibase::Checksum256&                 id,
                  psio::pssz_view<psibase::TransactionTrace> trace,
                  const ClientFilter&                         clientFilter = noFilter)
   {
      sendReply(claimClientReply(id, clientFilter), trace);
   }

   void sendReplies(const std::vector<psibase::Checksum256>& txids)
   {
      auto successfulTxs = RTransact::WriteOnly{}.open<TxSuccessTable>();
      auto failedTxs     = RTransact::Subjective{}.open<TxFailedTable>();

      TxStatsRecord stats{};

      for (auto id : txids)
      {
         // What keeps the bytes of traceView alive
         std::optional<psio::shared_pssz<TxSuccessRecord>>  successStorage;
         std::optional<psio::shared_pssz<TxFailedRecord>>   failedStorage;
         std::optional<psio::shared_pssz<TransactionTrace>> expiredStorage;
         std::optional<psio::pssz_view<TransactionTrace>>   traceView;

         if (auto tx = successfulTxs.getView(id))
         {
            traceView.emplace((*tx)->trace());
            successfulTxs.remove(**tx);
            successStorage = std::move(tx);
            PSIBASE_SUBJECTIVE_TX
            {
               // It is possible for a tx to have both failed and successful associated traces.
               // We want to prefer the successful result, so here we remove the failed trace
               //   (if it exists).
               failedTxs.erase(id);
            }
            ++stats.succeeded;
         }
         else
         {
            PSIBASE_SUBJECTIVE_TX
            {
               if (auto tx = failedTxs.getView(id))
               {
                  traceView.emplace((*tx)->trace());
                  failedTxs.remove(**tx);
                  failedStorage = std::move(tx);
                  ++stats.failed;
               }
            }
         }

         if (!traceView)
         {
            expiredStorage.emplace(TransactionTrace{.error = "Transaction expired"});
            traceView.emplace(**expiredStorage);
            ++stats.expired;
         }

         sendReply(id, *traceView);
      }

      stopTracking(txids, stats);

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
                  trace   = psio::to_pssz(failedTx.trace);
                  claimed = claimClientReply(failedTx.id, noFilter);
               }
            }
         }
         if (trace)
         {
            auto traceView = psio::pssz_view<TransactionTrace>{*trace};
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

   void reportSpeculativeFailure(psio::pssz_view<TransactionTrace> trace,
                                 const Checksum256&                 id,
                                 TimePointSec                       expiration,
                                 std::optional<Checksum256>&        errorTxId)
   {
      auto clients = RTransact{}.open<TraceClientTable>();
      RTransact{}.open<TransactionDataTable>().erase(id);
      incFailedCount();
      if (auto client = clients.get(id))
      {
         if (std::ranges::any_of(client->clients, WaitFor::isApplied))
            errorTxId = id;
         if (std::ranges::any_of(client->clients, WaitFor::isFinal))
            putFailed(id, expiration, trace);
      }
   }

}  // namespace

void RTransact::onTrx(const Checksum256& id, psio::pssz_view<TransactionTrace> trace)
{
   check(getSender() == AccountNumber{}, "Wrong sender");
   printf("trace size: %zu\n", psio::bytes(trace).size());

   auto clients = open<TraceClientTable>();

   bool waitForApplied = false;
   bool waitForFinal   = false;
   auto row            = std::optional<TraceClientRow>{};
   PSIBASE_SUBJECTIVE_TX
   {
      row = clients.get(id);
   }

   if (!isResMonitoring())
   {
      auto          table   = open<BlockSizeTable>();
      auto          sizeRow = table.get({}).value_or(BlockSizeRecord{0});
      std::uint32_t txSize  = 0;
      PSIBASE_SUBJECTIVE_TX
      {
         if (auto tx = open<TransactionDataTable>().getView(id))
         {
            txSize = tx->size();
         }
      }
      sizeRow.currentBlockSize += txSize;
      table.put(sizeRow);
   }

   if (row)
   {
      waitForApplied = std::ranges::any_of(row->clients, WaitFor::isApplied);
      waitForFinal   = std::ranges::any_of(row->clients, WaitFor::isFinal);
   }

   if (row)
   {
      if (!trace.error().has_value())
      {
         auto table    = WriteOnly{}.open<TxSuccessTable>();
         auto blockNum = to<Transact>().currentBlock().blockNum;
         if (isFullSize(trace))
            table.put(TxSuccessView{.id = id, .blockNum = blockNum, .trace = trace});
         else
            table.put(
                TxSuccessRecord{.id = id, .blockNum = blockNum, .trace = reducedTrace(trace)});
      }
      else
      {
         PSIBASE_SUBJECTIVE_TX
         {
            putFailed(id, row->expiration, trace);
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
   const auto stat = getOptionalStatus();
   check(stat && stat->head, "Head block should be set before calling onBlock");

   checkReverify(stat->head->blockId);

   if (!isResMonitoring())
   {
      open<BlockSizeTable>().erase({});
   }

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
   auto statsTable        = open<TxStatsTable>();

   // Get all successful and irreversible transactions
   auto successTxIdx = successfulTxTable.getIndex<1>();
   for (BlockNum blockNum : std::views::iota(finalized->first) | std::views::take(finalized->count))
   {
      for (const auto& tx : successTxIdx.subindex<psibase::Checksum256>(blockNum))
      {
         txids.push_back(tx.id);
      }
   }

   const auto nSuccessful = txids.size();

   PSIBASE_SUBJECTIVE_TX
   {
      // Get all expired transactions
      for (auto pendingTx : pendingTxTable.getIndex<3>())
      {
         if (pendingTx.expiration > finalized->time)
            break;

         if (!successfulTxTable.get(pendingTx.id))
            txids.push_back(pendingTx.id);
      }
   }

   // Ensure all txids have a client waiting for a reply
   std::vector<psibase::Checksum256> needsReply;
   std::size_t                       i = 0;
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
            auto stats = statsTable.get({}).value_or(TxStatsRecord{});
            --stats.unprocessed;
            if (i < nSuccessful)
               ++stats.succeeded;
            else
               ++stats.expired;
            statsTable.put(stats);
         }
      }
      ++i;
   }

   sendReplies(needsReply);
   sendFailureTraces(failedTxTable, finalized->time);
}

void RTransact::onVerify(std::uint64_t                      id,
                         psio::pssz_view<TransactionTrace> trace,
                         std::optional<RunToken>            token)
{
   check(getSender() == AccountNumber{}, "Wrong sender");
   auto pendingVerifies        = open<PendingVerifyTable>();
   auto unverifiedTransactions = open<UnverifiedTransactionTable>();
   auto reverify               = open<ReverifySignaturesTable>();
   auto runVerifyId = open<VerifyIdTable>(KvMode::read).get({}).value_or(VerifyIdRecord{}).verifyId;
   auto errorTxId   = std::optional<Checksum256>{};
   auto broadcastTxId = std::optional<Checksum256>{};
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
               reportSpeculativeFailure(trace, tx->id, tx->expiration, errorTxId);
            }
            else
            {
               auto data = open<TransactionDataTable>().getView(tx->id);
               check(data.has_value(), "Missing transaction data");
               scheduleVerify(tx->id, (*data)->trx(), tx->verified, tx->speculative);
            }
         }
      }
   }
   if (errorTxId)
   {
      sendReply(*errorTxId, trace, WaitFor::isApplied);
   }
   if (broadcastTxId)
      forwardStoredTransaction(*broadcastTxId);
}

void RTransact::onRequeue(std::uint64_t id, psio::pssz_view<TransactionTrace> trace)
{
   check(getSender() == AccountNumber{}, "Wrong sender");
   PSIBASE_SUBJECTIVE_TX
   {
      to<XRun>().finish(id);
   }
}

void RTransact::onSpecTrx(std::uint64_t id, psio::pssz_view<TransactionTrace> trace)
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
            reportSpeculativeFailure(trace, row->txid, expiration, errorTxId);
         }
      }
   }
   if (errorTxId)
   {
      sendReply(*errorTxId, trace, WaitFor::isApplied);
   }
   if (broadcastTxId)
      forwardStoredTransaction(*broadcastTxId);
}

namespace
{
   using Subjective = RTransact::Subjective;
   using WriteOnly  = RTransact::WriteOnly;

   // The largest body push_transaction accepts. While a transaction is
   // handed on to the other producers this service holds it four to five
   // times of its 32 MiB: the trace of its speculative run, which has it
   // twice, the token of that run where it carries the action (the tester),
   // the stored row, and the call of sendProds, which is one buffer.
   // Measured, 6 MiB is handed on and 6.5 MiB is not
   // (doc/pssz-conversion.md 7.11).
   constexpr std::size_t maxPushedTransactionSize = 5 * 1024 * 1024;

   std::uint64_t scheduleSpeculative(const Checksum256& id, psio::pssz_view<SignedTransaction> trx)
   {
      // The call of execTrx is written into the call of post: one buffer.
      LazyActionBuilder<Transact> transact{RTransact::service, Transact::service};
      auto runid = to<XRun>().post(RunMode::speculative, transact.execTrx(trx.transaction(), true),
                                   std::chrono::seconds(1), MethodNumber{"onSpecTrx"});
      RTransact{}.open<SpeculativeTransactionTable>().put({id, runid});
      return runid;
   }

   // Must be run inside PSIBASE_SUBJECTIVE_TX
   void scheduleVerify(const Checksum256&                 id,
                       psio::pssz_view<SignedTransaction> trx,
                       bool                               verified,
                       std::optional<std::uint64_t>       speculative)
   {
      auto pendingVerifies        = RTransact{}.open<PendingVerifyTable>();
      auto unverifiedTransactions = RTransact{}.open<UnverifiedTransactionTable>();

      std::vector<UnverifiedTransactionRecord::VerifyStatus> remaining;

      auto claims = trx.transaction()->claims();
      auto proofs = trx.proofs();
      check(claims.size() == proofs.size(), "Claims and proofs must have the same size");
      for (std::size_t i = 0; i < claims.size(); ++i)
      {
         auto runid = to<XRun>().verify(id, claims[i], proofs[i], std::chrono::milliseconds(200),
                                        MethodNumber{"onVerify"});
         remaining.push_back(runid);
         pendingVerifies.put({.txid = id, .runid = runid});
      }
      if (claims.empty())
      {
         queueTransaction(id, trx.transaction()->tapos().expiration(), std::move(remaining),
                          speculative);
      }
      else
      {
         UnverifiedTransactionRecord row{
             .id          = id,
             .expiration  = trx.transaction()->tapos().expiration(),
             .verifies    = std::move(remaining),
             .verified    = verified,
             .speculative = speculative,
         };
         unverifiedTransactions.put(row);
      }
   }

   bool pushTransaction(const Checksum256&                 id,
                        psio::pssz_view<SignedTransaction> trx,
                        bool                               speculate,
                        std::optional<TraceClientInfo>     client = std::nullopt)
   {
      bool result = true;
      PSIBASE_SUBJECTIVE_TX
      {
         if (client)
         {
            auto clients = RTransact{}.open<TraceClientTable>();
            auto row     = clients.get(id).value_or(
                TraceClientRow{.id = id, .expiration = trx.transaction()->tapos().expiration()});
            row.clients.push_back(*client);
            clients.put(row);
            to<HttpServer>().deferReply(client->socket);
         }
         auto pending = Subjective{}.open<PendingTransactionTable>();
         if (pending.get(id))
         {
            result = false;
            continue;
         }
         auto unverified = RTransact{}.open<UnverifiedTransactionTable>();
         if (auto row = unverified.get(id))
         {
            result = false;
            continue;
         }
         auto speculative = speculate ? std::optional{scheduleSpeculative(id, trx)} : std::nullopt;
         scheduleVerify(id, trx, false, speculative);
         Subjective{}.open<TransactionDataTable>().put(TransactionDataView{id, trx});
         auto statsTable = Subjective{}.open<TxStatsTable>();
         auto stats      = statsTable.get({}).value_or(TxStatsRecord{});
         ++stats.unprocessed;
         ++stats.total;
         statsTable.put(stats);
      }
      if (result && !speculate && trx.transaction()->claims().size() == 0)
      {
         forwardTransaction(trx);
      }
      return result;
   }

   // Hands a transaction to the other producers. The action that does it
   // (recv) is written from the transaction's bytes into the call of
   // sendProds: one buffer beside the transaction.
   void forwardTransaction(psio::pssz_view<SignedTransaction> trx)
   {
      LazyActionBuilder<RTransact> rtransact{HttpServer::service, RTransact::service};
      to<HttpServer>().sendProds(rtransact.recv(trx));
   }
   // The row is read as it is stored and is what the call is packed from.
   void forwardStoredTransaction(const Checksum256& id)
   {
      auto table = RTransact{}.open<TransactionDataTable>();
      decltype(table.getView(id)) data;
      PSIBASE_SUBJECTIVE_TX
      {
         data = table.getView(id);
      }
      if (data)
         forwardTransaction((*data)->trx());
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

   bool acceptJson(const HttpHeaders& headers)
   {
      return acceptWeight(headers, "application", "json") >=
             acceptWeight(headers, "application", "octet-stream");
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
      // Guest sessions have no account: sub is the null account and gst
      // identifies the guest's key. Empty for account sessions.
      std::string gst;
   };
   PSIO_REFLECT(LoginTokenData, sub, aud, exp, attr(gst, utf8))

   // POST /guest-login. The guest proves control of `key` by signing
   // sha256(guestLoginMessage(rootHost, exp)).
   struct GuestLoginRequest
   {
      std::vector<char> key;  // DER SubjectPublicKeyInfo
      std::int64_t      exp;  // seconds since the epoch
      std::vector<char> sig;  // 64-byte r || s, low-S
   };
   PSIO_REFLECT(GuestLoginRequest, key, exp, sig)

   struct GuestLoginReply
   {
      std::string  access_token;
      std::string  token_type = "bearer";
      std::string  guest;
      std::int64_t exp;
   };
   PSIO_REFLECT(GuestLoginReply,
                attr(access_token, utf8),
                attr(token_type, utf8),
                attr(guest, utf8),
                exp)

   // A guest login proof is accepted for at most this long.
   constexpr std::int64_t maxGuestLoginWindow = 120;

   std::string guestLoginMessage(std::string_view rootHost, std::int64_t exp)
   {
      return std::format("psibase guest login\n{}\n{}", rootHost, exp);
   }

   std::string guestId(std::span<const char> key)
   {
      static const char digits[] = "0123456789abcdef";
      auto              hash     = sha256(key.data(), key.size());
      std::string       result;
      for (std::size_t i = 0; i < 16; ++i)
      {
         auto b = static_cast<unsigned char>(hash[i]);
         result += digits[b >> 4];
         result += digits[b & 15];
      }
      return result;
   }

   struct LoginReply
   {
      std::string access_token;
      std::string token_type = "bearer";
   };
   PSIO_REFLECT(LoginReply, attr(access_token, utf8), attr(token_type, utf8))

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
         result = psio::from_ijson<T>(request.body);
      }
      else if (request.contentType == "application/octet-stream")
      {
         // The body comes from a client: it is used only if it is a valid
         // packed T.
         if (!psio::validate_pssz<T>(request.body).ok())
            abortMessage("The body is not a valid packed value");
         result = psio::from_pssz<T>(psio::trusted{request.body});
      }
      else
      {
         abortMessage("Expected a json or packed body");
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
         std::uint64_t foundSequence;
         PSIBASE_SUBJECTIVE_TX
         {
            auto iter = pendingBySequence.lower_bound(nextSequence);
            auto item = *iter;
            if (item.sequence < endSequence)
            {
               auto data = txdata.getView(item.id);
               check(!!data, "Missing transaction data");

               pending.remove(item);

               scheduleVerify(item.id, (*data)->trx(), true, item.speculative);
            }
            foundSequence = item.sequence;
         }
         nextSequence = foundSequence + 1;
         if (nextSequence >= endSequence)
            break;
      }
   }
}

void RTransact::recv(psio::pssz_view<SignedTransaction> trx)
{
   check(getSender() == HttpServer::service, "Wrong sender");
   auto packed      = trx.transaction().bytes();
   auto id          = psibase::sha256(packed.data(), packed.size());
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

namespace
{
   std::optional<LoginTokenData> findSessionToken(const HttpRequest& request)
   {
      std::vector<char>             key = getJWTKey();
      std::optional<LoginTokenData> result;
      auto                          rootHost = to<HttpServer>().rootHost(request.host);

      auto isValidJwt = [&](const LoginTokenData& decoded)
      { return decoded.aud == rootHost && checkExp(decoded.exp); };

      for (const auto& header : request.headers)
      {
         if (iequal(header.name, "authorization"))
         {
            parseHeader(header.value,
                        [&](std::string_view value)
                        {
                           std::string_view prefix = "Bearer ";
                           if (value.starts_with(prefix))
                           {
                              auto token   = value.substr(prefix.size());
                              auto decoded = decodeJWT<LoginTokenData>(key, token);
                              if (decoded && isValidJwt(*decoded))
                              {
                                 result = std::move(*decoded);
                              }
                           }
                        });
            if (result)
               return result;
         }
      }

      std::string_view cookieName = "__Host-SESSION";

      auto tokens = request.getCookie(cookieName);
      for (const auto& token : tokens)
      {
         auto decoded = decodeJWT<LoginTokenData>(key, token);
         if (decoded && isValidJwt(*decoded))
            return decoded;
      }
      return {};
   }
}  // namespace

SessionInfo RTransact::getSession(HttpRequest request)
{
   SessionInfo result;
   if (auto token = findSessionToken(request))
   {
      if (!token->gst.empty())
         result.guest = std::move(token->gst);
      else if (token->sub != AccountNumber{})
         result.user = token->sub;
   }
   return result;
}

std::optional<AccountNumber> RTransact::getUser(HttpRequest request)
{
   // A guest is not a user: apps see no account for a guest session.
   return getSession(std::move(request)).user;
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
PSIO_TYPE_ATTRS(TransactQuery, psio::graphql::name_as{"Query"})

std::optional<HttpReply> RTransact::serveSys(psio::pssz_view<psibase::HttpRequest> packedRequest,
                                             std::optional<std::int32_t>           socket,
                                             std::optional<AccountNumber>          user)
{
   // Everything but the body, which push_transaction reads where it lies
   // and the other endpoints copy below.
   HttpRequest           request{.host        = std::string{packedRequest.host()},
                                 .method      = std::string{packedRequest.method()},
                                 .target      = std::string{packedRequest.target()},
                                 .contentType = std::string{packedRequest.contentType()},
                                 .headers     = packedRequest.headers().unpack()};
   std::span<const char> body = packedRequest.body();

   auto make400 = [&](std::string_view message)
   {
      return HttpReply{
          .status      = HttpStatus::badRequest,
          .contentType = "text/html",
          .body{message.begin(), message.end()},
          .headers = allowCors(request, AccountNumber{"supervisor"}),
      };
   };
   auto make404 = [&](std::string_view message)
   {
      return HttpReply{
          .status      = HttpStatus::notFound,
          .contentType = "text/html",
          .body{message.begin(), message.end()},
          .headers = allowCors(request, AccountNumber{"supervisor"}),
      };
   };
   auto make415 = [&](std::string_view message)
   {
      return HttpReply{
          .status      = HttpStatus::unsupportedMediaType,
          .contentType = "text/html",
          .body{message.begin(), message.end()},
          .headers = allowCors(request, AccountNumber{"supervisor"}),
      };
   };

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
         return make415("Expected PSSZ encoded signed transaction (application/octet-stream)");

      if (body.size() > maxPushedTransactionSize)
      {
         auto message =
             std::format("The transaction is {} bytes. push_transaction accepts at most {} bytes.",
                         body.size(), maxPushedTransactionSize);
         return HttpReply{
             .status      = HttpStatus::contentTooLarge,
             .contentType = "text/html",
             .body{message.begin(), message.end()},
             .headers = allowCorsSubdomains(request),
         };
      }

      auto query = request.query<WaitFor>();
      // The body comes from a client: it is validated once, here, and
      // then read through the view. Nothing below unpacks it.
      auto trx         = psio::validated_view<SignedTransaction>(psio::pssz{}, body).value();
      auto packed      = trx.transaction().bytes();
      auto id          = psibase::sha256(packed.data(), packed.size());
      bool enforceAuth = validateTransaction(id, trx);
      bool json        = acceptJson(request.headers);
      auto client      = TraceClientInfo{*socket, json, query.flag()};
      pushTransaction(id, trx, enforceAuth, std::move(client));
      return {};
   }

   request.body.assign(body.begin(), body.end());

   if (request.method == "POST" && target == "/guest-login")
   {
      auto data = parseBody<GuestLoginRequest>(request);
      auto now  = std::chrono::duration_cast<std::chrono::seconds>(
                      std::chrono::system_clock::now().time_since_epoch())
                      .count();
      if (data.exp < now || data.exp > now + maxGuestLoginWindow)
         return make400("Guest login proof expired or too far in the future");
      if (data.key.empty() || data.key.size() > 128 || data.sig.size() != 64)
         return make400("Malformed guest login");
      auto host    = std::string(rootHost(request));
      auto message = guestLoginMessage(host, data.exp);
      // Aborts the request if the key is unsupported or the proof is wrong.
      const AccountNumber verifySig{"verify-sig"};
      Actor<VerifyInterface> verify(RTransact::service, verifySig);
      verify.verifySys(sha256(message.data(), message.size()),
                       Claim{verifySig, data.key}, data.sig);

      auto exp = now + std::chrono::duration_cast<std::chrono::seconds>(std::chrono::days(30))
                           .count();
      auto id    = guestId(data.key);
      auto token = encodeJWT(getJWTKey(), LoginTokenData{.sub = AccountNumber{},
                                                         .aud = host,
                                                         .exp = exp,
                                                         .gst = id});
      HttpReply reply{.contentType = "application/json",
                      .headers     = allowCors(request, AccountNumber{"supervisor"})};
      psio::to_ijson(GuestLoginReply{.access_token = token, .guest = id, .exp = exp}, reply.body);
      return reply;
   }

   if (request.method == "POST" && target == "/login")
   {
      auto trx = parseBody<SignedTransaction>(request);
      // A JSON body gives the packed transaction as hex, which the JSON
      // reader copies without looking at it; the views below read it.
      if (!psio::validate_pssz<Transaction>(
              std::span<const char>{trx.transaction.data(), trx.transaction.size()}).ok())
         return make400("Invalid transaction");
      if (trx.transaction->actions().size() != 1 ||
          trx.transaction->actions()[0].method() != MethodNumber{"loginSys"})
         return make400("Expected a login transaction");
      if (!(trx.transaction->tapos().flags() & Tapos::do_not_broadcast_flag))
         return make400("Login transaction must be do_not_broadcast");
      auto loginAct = trx.transaction->actions()[0];
      auto sender   = loginAct.sender().unpack();
      auto app      = loginAct.service().unpack();
      auto data     = psio::from_pssz<LoginData>(loginAct.rawData());
      if (!checkExp(trx.transaction->tapos().expiration()))
         return make400("Login expired");
      if (data.rootHost == rootHost(request))
      {
         // verify signatures
         auto claims = trx.transaction->claims();
         if (claims.size() != trx.proofs.size())
            return make400("Proofs and claims must have the same size");
         for (std::size_t i = 0; i < trx.proofs.size(); ++i)
         {
            Actor<VerifyInterface> verify(RTransact::service, claims[i].service());
            verify.verifySys(sha256(trx.transaction.data(), trx.transaction.size()), claims[i],
                             trx.proofs[i]);
         }
         // check auth
         auto account = to<Accounts>().getAccount(sender);
         if (!account)
            return make404("Account not found");
         Actor<AuthInterface> auth(RTransact::service, account->authService);
         auto                 flags = AuthInterface::firstAuthFlag;
         if (!auth.checkAuthSys(flags, sender, ServiceMethod{AccountNumber{}, MethodNumber{}},
                                claims))
         {
            return make400("Login failed");
         }
         // Construct token
         auto exp = std::chrono::time_point_cast<std::chrono::seconds>(
             std::chrono::system_clock::now() + std::chrono::days(30));
         auto token = encodeJWT(getJWTKey(), LoginTokenData{.sub = sender,
                                                            .aud = std::string(rootHost(request)),
                                                            .exp = exp.time_since_epoch().count()});
         HttpReply           reply{.contentType = "application/json",
                                   .headers     = allowCors(request, AccountNumber{"supervisor"})};
         psio::to_ijson(LoginReply{token}, reply.body);
         return reply;
      }
      else
      {
         return make400("Login data contians invalid root host");
      }
   }
   else if (target == "/jwt_key" && request.method == "GET")
   {
      if (!to<XAdmin>().isAdmin(user, socket, forwardedFor(request)))
      {
         std::string_view msg = "Not authorized";
         return HttpReply{.status      = user ? HttpStatus::forbidden : HttpStatus::unauthorized,
                          .contentType = "text/html",
                          .body        = std::vector(msg.begin(), msg.end()),
                          .headers     = allowCors(request, AccountNumber{"x-admin"})};
      }
      return HttpReply{.contentType = "application/octet-stream",
                       .body        = getJWTKey(),
                       .headers     = allowCors(request, AccountNumber{"supervisor"})};
   }
   else if (target == "/stats" && request.method == "GET")
   {
      if (!to<XAdmin>().isAdmin(user, socket, forwardedFor(request)))
      {
         std::string_view msg = "Not authorized";
         return HttpReply{.status      = user ? HttpStatus::forbidden : HttpStatus::unauthorized,
                          .contentType = "text/html",
                          .body        = std::vector(msg.begin(), msg.end()),
                          .headers     = allowCors(request, AccountNumber{"x-admin"})};
      }
      HttpReply reply{
          .contentType = "application/json",
          .headers     = allowCors(request, AccountNumber{"x-admin"}),
      };
      TxStatsRecord stats;
      PSIBASE_SUBJECTIVE_TX
      {
         stats = open<TxStatsTable>().get({}).value_or(TxStatsRecord{});
      }
      psio::to_ijson(stats, reply.body);
      return reply;
   }
   else if (auto result = serveGraphQL(request, TransactQuery{}))
      return result;

   return {};
}

PSIBASE_DISPATCH(RTransact)
