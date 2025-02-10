#include <services/system/Accounts.hpp>
#include <services/system/HttpServer.hpp>
#include <services/system/RTransact.hpp>
#include <services/system/Transact.hpp>

#include <psibase/dispatch.hpp>
#include <psibase/jwt.hpp>
#include <psibase/serveSchema.hpp>

using namespace psibase;
using namespace SystemService;

std::optional<SignedTransaction> SystemService::RTransact::next()
{
   check(getSender() == AccountNumber{}, "Wrong sender");
   auto unapplied = WriteOnly{}.open<UnappliedTransactionTable>();
   auto nextSequence =
       unapplied.get(SingletonKey{}).value_or(UnappliedTransactionRecord{0}).nextSequence;
   auto included = Transact::Tables{Transact::service}.open<IncludedTrxTable>();
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

void RTransact::onTrx(const Checksum256& id, const TransactionTrace& trace)
{
   check(getSender() == AccountNumber{}, "Wrong sender");
   auto                          clients = Subjective{}.open<TraceClientTable>();
   std::optional<TraceClientRow> row;
   bool                          json;
   bool                          bin;
   PSIBASE_SUBJECTIVE_TX
   {
      json = false;
      bin  = false;
      row  = clients.get(id);
      if (row)
      {
         clients.remove(*row);
         for (auto client : row->clients)
         {
            if (client.json)
               json = true;
            else
               bin = true;
            to<HttpServer>().claimReply(client.socket);
         }
      }
   }
   if (json)
   {
      HttpReply           reply{.contentType = "application/json"};
      psio::vector_stream stream{reply.body};
      to_json(trace, stream);
      for (auto client : row->clients)
         if (client.json)
            to<HttpServer>().sendReply(client.socket, reply);
   }
   if (bin)
   {
      HttpReply           reply{.contentType = "application/octet-stream"};
      psio::vector_stream stream{reply.body};
      to_frac(trace, stream);
      for (auto client : row->clients)
         if (!client.json)
            to<HttpServer>().sendReply(client.socket, reply);
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
   BlockTime irreversibleTime = {};
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
      TransactionTrace trace{.error = "Transaction expired"};
      HttpReply        json{.contentType = "application/json"};
      {
         psio::vector_stream stream{json.body};
         to_json(trace, stream);
      }
      HttpReply bin{.contentType = "application/octet-stream"};
      {
         psio::vector_stream stream{bin.body};
         to_frac(trace, stream);
      }
      for (auto row : ids)
      {
         for (auto client : row.clients)
            to<HttpServer>().sendReply(client.socket, client.json ? json : bin);
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
                     NotifyRow{NotifyType::nextTransaction,
                               {{.service = RTransact::service, .method = MethodNumber{"next"}}}});
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
         row        = index.get(SingletonKey{});
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
                           if (decoded.aud == request.host && checkExp(decoded.exp))
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
      if (decoded.aud == request.host && checkExp(decoded.exp))
         return decoded.sub;
   }
   return {};
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
      auto trx  = psio::from_frac<SignedTransaction>(request.body);
      auto id   = psibase::sha256(trx.transaction.data(), trx.transaction.size());
      bool json = acceptJson(request.headers);
      PSIBASE_SUBJECTIVE_TX
      {
         auto clients = Subjective{}.open<TraceClientTable>();
         auto row     = clients.get(id).value_or(TraceClientRow{.id = id});
         row.clients.push_back({*socket, json});
         clients.put(row);
         to<HttpServer>().deferReply(*socket);
      }
      if (pushTransaction(id, trx))
         forwardTransaction(trx);
   }
   else if (request.method == "POST" && request.target == "/login")
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
         auto appHost = app.str() + "." + request.rootHost;
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
         auto                 accountsTables = Accounts::Tables(Accounts::service);
         auto                 accountTable   = accountsTables.open<AccountTable>();
         auto                 accountIndex   = accountTable.getIndex<0>();
         auto                 account        = accountIndex.get(sender);
         Actor<AuthInterface> auth(RTransact::service, account->authService);
         auto                 flags = AuthInterface::topActionReq | AuthInterface::firstAuthFlag;
         auth.checkAuthSys(flags, psibase::AccountNumber{}, sender,
                           ServiceMethod{AccountNumber{}, MethodNumber{}},
                           std::vector<ServiceMethod>{}, claims);
         // Construct token
         auto exp = std::chrono::time_point_cast<std::chrono::seconds>(
             std::chrono::system_clock::now() + std::chrono::days(30));
         auto                token = encodeJWT(getJWTKey(), LoginTokenData{.sub = sender,
                                                                           .aud = std::move(appHost),
                                                                           .exp = exp.time_since_epoch().count()});
         HttpReply           reply{.contentType = "application/json"};
         psio::vector_stream stream{reply.body};
         to_json(LoginReply{token}, stream);
         return reply;
      }
   }
   else if (auto res = serveSchema<Transact>(request))
   {
      return res;
   }

   return {};
}

PSIBASE_DISPATCH(RTransact)
