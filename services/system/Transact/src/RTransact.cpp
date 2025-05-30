#include <services/system/Accounts.hpp>
#include <services/system/HttpServer.hpp>
#include <services/system/RTransact.hpp>
#include <services/system/Transact.hpp>

#include <functional>
#include <psibase/dispatch.hpp>
#include <psibase/jwt.hpp>
#include <ranges>

using namespace psibase;
using namespace SystemService;

std::optional<SignedTransaction> SystemService::RTransact::next()
{
   check(getSender() == AccountNumber{}, "Wrong sender");
   auto unapplied    = WriteOnly{}.open<UnappliedTransactionTable>();
   auto nextSequence = unapplied.get({}).value_or(UnappliedTransactionRecord{0}).nextSequence;
   auto included     = Transact::Tables{Transact::service}.open<IncludedTrxTable>();
   std::optional<SignedTransaction> result;
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
         // Unregister callback
         auto key = notifyKey(NotifyType::nextTransaction);
         if (auto existing = kvGet<NotifyRow>(DbId::nativeSubjective, key))
         {
            std::erase_if(existing->actions,
                          [](const auto& act) { return act.service == RTransact::service; });
            if (existing->actions.empty())
            {
               kvRemove(DbId::nativeSubjective, key);
            }
            else
            {
               kvPut(DbId::nativeSubjective, key, *existing);
            }
         }
      }
   }
   return result;
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
   auto claimClientReply(const psibase::Checksum256& id, const ClientFilter& clientFilter)
       -> std::tuple<std::vector<std::int32_t>, std::vector<std::int32_t>>
   {
      {
         auto                      clients = RTransact::Subjective{}.open<TraceClientTable>();
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
               if (std::ranges::none_of(row.clients, clientFilter))
                  abortMessage("No clients matching filter to claim a reply for this tx");

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

   auto finalizeBlocks(const psibase::BlockHeader& current)
       -> std::pair<std::vector<psibase::BlockNum>, psibase::BlockTime>
   {
      {
         auto commitNum  = current.commitNum;
         auto reversible = RTransact::WriteOnly{}.open<ReversibleBlocksTable>();
         reversible.put({.blockNum = current.blockNum, .time = current.time});

         BlockTime irreversibleTime = {};

         std::vector<psibase::BlockNum> irreversible;
         for (auto r : reversible.getIndex<0>())
         {
            if (r.blockNum > commitNum)
               break;
            irreversibleTime = r.time;
            if (r.blockNum < commitNum)
            {
               reversible.remove(r);
               irreversible.push_back(r.blockNum);
            }
         }

         return {irreversible, irreversibleTime};
      }
   }

   void stopTracking(const std::vector<psibase::Checksum256>& txids)
   {
      auto pendingTxTable = RTransact::Subjective{}.open<PendingTransactionTable>();
      auto dataTable      = RTransact::Subjective{}.open<TransactionDataTable>();

      PSIBASE_SUBJECTIVE_TX
      {
         for (auto id : txids)
         {
            pendingTxTable.erase(id);
            dataTable.erase(id);
         }
      }
   }

   void sendReply(const psibase::Checksum256&                 id,
                  psio::view<const psibase::TransactionTrace> trace,
                  const ClientFilter&                         clientFilter = noFilter)
   {
      TransactionTraceRef pruned     = PruneTrace{true}(trace);
      auto [jsonClients, binClients] = claimClientReply(id, clientFilter);

      if (jsonClients.empty() && binClients.empty())
         return;

      ActionViewBuilder<HttpServer> http{getReceiver(), HttpServer::service};

      if (!jsonClients.empty())
      {
         JsonHttpReply<TransactionTraceRef&> reply{.contentType = "application/json",
                                                   .body{pruned}};
         auto                                action = http.sendReply(0, reply);

         for (auto socket : jsonClients)
         {
            psio::get<0>(action->rawData().value()) = socket;
            call(action.data(), action.size());
         }
      }

      if (!binClients.empty())
      {
         FracpackHttpReply<TransactionTraceRef&> reply{.contentType = "application/octet-stream",
                                                       .body{pruned}};
         auto                                    action = http.sendReply(0, reply);

         for (auto socket : binClients)
         {
            psio::get<0>(action->rawData().value()) = socket;
            call(action.data(), action.size());
         }
      }
   }

   void sendReplies(const std::vector<psibase::Checksum256>& txids)
   {
      stopTracking(txids);
      auto successfulTxs = RTransact::WriteOnly{}.open<TxSuccessTable>();
      auto failedTxs     = RTransact::Subjective{}.open<TxFailedTable>();

      for (auto id : txids)
      {
         std::optional<std::vector<char>> trace;

         if (auto tx = successfulTxs.get(id))
         {
            trace = psio::to_frac(tx->trace);
            successfulTxs.erase(id);
         }

         PSIBASE_SUBJECTIVE_TX
         {
            if (auto tx = failedTxs.get(id))
            {
               if (!trace)
               {
                  trace = psio::to_frac(tx->trace);
               }

               failedTxs.erase(id);
            }
         }

         if (!trace)
         {
            trace = psio::to_frac(TransactionTrace{.error = "Transaction expired"});
         }

         auto traceView = psio::view<const TransactionTrace>{psio::prevalidated{*trace}};
         sendReply(id, traceView);
      }
#ifdef __wasm32__
      printf("memory usage: %lu\n", __builtin_wasm_memory_size(0) * 65536);
#endif
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

}  // namespace

void RTransact::onTrx(const Checksum256& id, psio::view<const TransactionTrace> trace)
{
   check(getSender() == AccountNumber{}, "Wrong sender");
   printf("trace size: %zu\n", find_view_span(trace).size());

   auto clients = Subjective{}.open<TraceClientTable>();

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
         WriteOnly{}.open<TxSuccessTable>().put(TxSuccessRecord{
             .id       = id,
             .blockNum = to<Transact>().currentBlock().blockNum,
             .trace    = trace.unpack(),
         });
      }
      else
      {
         PSIBASE_SUBJECTIVE_TX
         {
            Subjective{}.open<TxFailedTable>().put(TxFailedRecord{
                .id    = id,
                .trace = trace.unpack(),
            });
         }
      }
   }

   if (waitForApplied)
   {
      sendReply(id, trace, WaitFor::isApplied);
   }
}

void RTransact::onBlock()
{
   check(getSender() == AccountNumber{}, "Wrong sender");
   auto stat = psibase::kvGet<psibase::StatusRow>(psibase::StatusRow::db, psibase::statusKey());
   if (!stat)
      return;

   auto [irreversible, irreversibleTime] = finalizeBlocks(stat->current);

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
   auto clientTable       = Subjective{}.open<TraceClientTable>();

   // Get all successful and irreversible transactions
   auto successTxIdx = successfulTxTable.getIndex<1>();
   for (BlockNum blockNum : irreversible)
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
         if (pendingTx.expiration > irreversibleTime)
            break;

         if (auto client = clientTable.get(pendingTx.id))
         {
            txids.push_back(pendingTx.id);
         }
         else
         {  // Stop tracking an expired tx if no client is waiting for a reply.
            pendingTxTable.erase(pendingTx.id);
            dataTable.erase(pendingTx.id);

            successfulTxTable.erase(pendingTx.id);
            failedTxTable.erase(pendingTx.id);
         }
      }
   }

   sendReplies(txids);
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
         auto sequence  = available.get({}).value_or(AvailableSequenceRecord{0}).nextSequence;
         available.put({sequence + 1});
         pending.put({.id         = id,
                      .expiration = trx.transaction->tapos().expiration(),
                      .ctime      = std::chrono::time_point_cast<psibase::Seconds>(
                          std::chrono::system_clock::now()),
                      .sequence = sequence});
         Subjective{}.open<TransactionDataTable>().put({.id = id, .trx = trx});

         // Tell native that we have a transaction
         {
            auto key = notifyKey(NotifyType::nextTransaction);
            if (auto existing = kvGet<NotifyRow>(DbId::nativeSubjective, key))
            {
               if (!std::ranges::any_of(existing->actions, [](const auto& act)
                                        { return act.service == RTransact::service; }))
               {
                  existing->actions.push_back(
                      {.service = RTransact::service, .method = MethodNumber{"next"}});
                  kvPut(DbId::nativeSubjective, key, *existing);
               }
            }
            else
            {
               kvPut(DbId::nativeSubjective, key,
                     NotifyRow{.type    = NotifyType::nextTransaction,
                               .actions = {
                                   {//
                                    .service = RTransact::service,
                                    .method  = "next"_m}  //
                               }});
            }
         }
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

void RTransact::recv(const SignedTransaction& trx)
{
   check(getSender() == HttpServer::service, "Wrong sender");
   auto id = psibase::sha256(trx.transaction.data(), trx.transaction.size());
   if (pushTransaction(id, trx))
      forwardTransaction(trx);
}

std::optional<AccountNumber> RTransact::getUser(HttpRequest request)
{
   std::vector<char>            key = getJWTKey();
   std::optional<AccountNumber> result;
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
   if (auto token = request.getCookie("__Host-SESSION"))
   {
      auto decoded = decodeJWT<LoginTokenData>(key, *token);
      if (decoded.aud == request.rootHost && checkExp(decoded.exp))
         return decoded.sub;
   }
   return {};
}

std::optional<HttpReply> RTransact::serveSys(const psibase::HttpRequest& request,
                                             std::optional<std::int32_t> socket)
{
   check(getSender() == HttpServer::service, "Wrong sender");
   check(socket.has_value(), "Missing socket");
   auto target = request.path();
   if (request.method == "POST" && target == "/push_transaction")
   {
      if (request.contentType != "application/octet-stream")
         abortMessage("Expected fracpack encoded signed transaction (application/octet-stream)");

      auto query = request.query<WaitFor>();
      auto trx   = psio::from_frac<SignedTransaction>(request.body);
      auto id    = psibase::sha256(trx.transaction.data(), trx.transaction.size());
      bool json  = acceptJson(request.headers);
      PSIBASE_SUBJECTIVE_TX
      {
         auto clients = Subjective{}.open<TraceClientTable>();
         auto row     = clients.get(id).value_or(TraceClientRow{.id = id});
         row.clients.push_back({*socket, json, query.flag()});
         clients.put(row);
         to<HttpServer>().deferReply(*socket);
      }
      if (pushTransaction(id, trx))
         forwardTransaction(trx);
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
         HttpReply           reply{.contentType = "application/json"};
         psio::vector_stream stream{reply.body};
         to_json(LoginReply{token}, stream);
         return reply;
      }
   }

   return {};
}

PSIBASE_DISPATCH(RTransact)
