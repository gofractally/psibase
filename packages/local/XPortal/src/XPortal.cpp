#include <services/local/XPortal.hpp>

#include <algorithm>
#include <limits>
#include <psibase/base64.hpp>
#include <psibase/dispatch.hpp>
#include <psibase/nativeTables.hpp>
#include <psibase/trace.hpp>
#include <psio/json/any.hpp>
#include <services/local/XAdmin.hpp>
#include <services/local/XHttp.hpp>
#include <services/local/XKeys.hpp>
#include <services/local/XTimer.hpp>
#include <services/system/Accounts.hpp>
#include <services/system/AuthScope.hpp>
#include <services/system/AuthSig.hpp>
#include <services/system/RTransact.hpp>
#include <services/system/VirtualServer.hpp>
#include <services/user/Tokens.hpp>
#include <tuple>

using namespace psibase;
using namespace LocalService;
using namespace SystemService;
using namespace UserService;

namespace
{
   constexpr uint64_t seedUsdMicros    = 2'500'000;
   constexpr uint64_t freeTierUsdCents = 250;

   constexpr std::string_view stateQueued    = "queued";
   constexpr std::string_view stateCreated   = "created";
   constexpr std::string_view stateFailed    = "failed";
   constexpr std::string_view signingAborted = "signing aborted";
   constexpr char              signupMemo[]  = "x-portal signup";

   struct ListenSpec
   {
      std::string                  protocol;
      std::optional<std::string>   path;
      std::optional<std::string>   address;
      std::optional<std::uint16_t> port;
      PSIO_REFLECT(ListenSpec, protocol, path, address, port)
   };
   struct HostSettings
   {
      std::optional<AccountNumber> producer;
      std::vector<ListenSpec>      listen;
      PSIO_REFLECT(HostSettings, producer, listen)
   };
   struct HostFile
   {
      HostSettings host;
      PSIO_REFLECT(HostFile, host)
   };

   std::vector<HttpHeader> cors(const HttpRequest& req)
   {
      return allowCors(req, {XPortal::service, XAdmin::service});
   }

   HttpReply jsonBody(std::vector<HttpHeader> headers, const auto& value)
   {
      HttpReply           reply{.contentType = "application/json", .headers = std::move(headers)};
      psio::vector_stream stream{reply.body};
      to_json(value, stream);
      return reply;
   }

   HttpReply jsonBody(const HttpRequest& req, const auto& value)
   {
      return jsonBody(cors(req), value);
   }

   HttpReply textError(std::vector<HttpHeader> headers, HttpStatus status, std::string_view message)
   {
      return HttpReply{.status      = status,
                       .contentType = "text/html",
                       .body        = std::vector<char>(message.begin(), message.end()),
                       .headers     = std::move(headers)};
   }

   HttpReply textError(const HttpRequest& req, HttpStatus status, std::string_view message)
   {
      return textError(cors(req), status, message);
   }

   PortalConfig readConfig()
   {
      std::optional<PortalConfig> stored;
      PSIBASE_SUBJECTIVE_TX
      {
         stored = XPortal{}.open<PortalConfigTable>().get({});
      }
      return stored.value_or(PortalConfig{});
   }

   std::optional<AgentKey> readCreatorAgentKey()
   {
      std::optional<AgentKey> stored;
      PSIBASE_SUBJECTIVE_TX
      {
         stored = XPortal{}.open<AgentKeyTable>().get(std::string{XPortal::creatorAgent});
      }
      return stored;
   }

   void writeConfig(const PortalConfig& config)
   {
      PSIBASE_SUBJECTIVE_TX
      {
         XPortal{}.open<PortalConfigTable>().put(config);
      }
   }

   // Smallest units in one whole token. Precision is at most 8.
   uint64_t unitScale(uint8_t precision)
   {
      uint64_t scale = 1;
      for (uint8_t i = 0; i < precision; ++i)
         scale *= 10;
      return scale;
   }

   // $2.50 per standard buffer, stored as USD micros per whole token.
   PortalConfig ensurePriced(PortalConfig config)
   {
      if (!to<VirtualServer>().is_billing_enabled() || config.price_per_token_usd_micros)
         return config;

      auto token = to<Tokens>().getSysToken();
      check(token.has_value(), "system token is not set");
      auto scale = unitScale(token->precision.value);
      auto cost  = to<VirtualServer>().std_buffer_cost().value;
      check(cost != 0, "standard buffer cost is zero");
      check(seedUsdMicros <= std::numeric_limits<uint64_t>::max() / scale, "seed price overflow");
      auto price = (seedUsdMicros * scale) / cost;
      check(price != 0, "seeded token price is zero for buffer cost " + std::to_string(cost));
      config.price_per_token_usd_micros = price;
      config.free_tier.enabled          = true;
      config.free_tier.usd_cents        = freeTierUsdCents;
      writeConfig(config);
      return config;
   }

   PortalConfig loadedConfig()
   {
      return ensurePriced(readConfig());
   }

   Quantity tokensFor(uint64_t usdCents, uint64_t priceMicros, uint8_t precision)
   {
      check(priceMicros != 0, "token price is zero");
      auto scale = unitScale(precision);
      check(usdCents <= std::numeric_limits<uint64_t>::max() / 10'000, "tier amount overflow");
      auto usdMicros = usdCents * 10'000;
      check(usdMicros <= std::numeric_limits<uint64_t>::max() / scale, "tier amount overflow");
      return Quantity{(usdMicros * scale) / priceMicros};
   }

   std::optional<Quantity> tierTokens(const PortalConfig& config)
   {
      if (!config.price_per_token_usd_micros || !config.free_tier.usd_cents)
         return std::nullopt;
      auto token = to<Tokens>().getSysToken();
      check(token.has_value(), "system token is not set");
      return tokensFor(*config.free_tier.usd_cents, *config.price_per_token_usd_micros,
                       token->precision.value);
   }

   bool creatorReady()
   {
      auto key = readCreatorAgentKey();
      if (!key)
         return false;
      auto row = to<AuthScope>().get(XPortal::creatorAccount);
      return row.has_value() && row->pubkey == key->pubkey;
   }

   // C++ compresses "get_resources" to a different number than the Rust service.
   Quantity resourceBuffer(AccountNumber account)
   {
      Action action{getReceiver(), VirtualServer::service, MethodNumber{"#alaedsealcysoanp"},
                    psio::convert_to_frac(std::tuple{account})};
      return fraccall<Quantity>(action).unpack();
   }

   bool creatorFunded(const PortalConfig& config)
   {
      auto grant = tierTokens(config);
      check(grant.has_value(), "free tier grant is not set");
      auto sys = to<Tokens>().getSysToken();
      check(sys.has_value(), "system token is not set");
      auto balance = to<Tokens>().getBalance(sys->id, XPortal::creatorAccount);
      auto buffer  = resourceBuffer(XPortal::creatorAccount);
      return balance.value >= grant->value && buffer.value > 0;
   }

   std::optional<HostSettings> hostSettings()
   {
      std::optional<HostConfigRow> row;
      PSIBASE_SUBJECTIVE_TX
      {
         row = Native::session().open<HostConfigTable>().get({});
      }
      if (!row)
         return std::nullopt;
      return psio::convert_from_json<HostFile>(row->config).host;
   }

   std::optional<AccountNumber> configuredProducer()
   {
      auto settings = hostSettings();
      if (!settings || !settings->producer || *settings->producer == AccountNumber{})
         return std::nullopt;
      return settings->producer;
   }

   // Prefers the node's unix socket. A wildcard TCP address connects over loopback.
   SocketEndpoint nodeEndpoint()
   {
      auto settings = hostSettings();
      check(settings.has_value(), "node host config is not set");
      const auto& listen = settings->listen;
      if (auto local = std::ranges::find(listen, "local", &ListenSpec::protocol);
          local != listen.end())
         return LocalEndpoint{local->path.value()};

      auto http = std::ranges::find(listen, "http", &ListenSpec::protocol);
      check(http != listen.end(), "node has no unix socket or http listener");
      auto address = parseIPAddress(http->address.value());
      check(address.has_value(), "invalid listen address " + *http->address);
      auto port = http->port.value();
      if (auto* v4 = std::get_if<IPV4Address>(&*address))
      {
         if (*v4 == IPV4Address{})
            *v4 = IPV4Address{{127, 0, 0, 1}};
         return IPV4Endpoint{*v4, port};
      }
      auto& v6 = std::get<IPV6Address>(*address);
      if (v6 == IPV6Address{})
         v6.bytes.back() = 1;
      return IPV6Endpoint{v6, port};
   }

   using PushResult = std::variant<TransactionTrace, std::string>;

   // Signs `actions` with x-portal's x-keys keys and sends them to this node's
   // `transact`. The final result goes to `replyTo` when set, and updates
   // `signup` when set.
   //
   // `signTx` aborts the caller when the signing account's auth rejects the
   // actions, so callers commit any attempt bookkeeping before calling this.
   void pushAgentTx(std::vector<Action>        actions,
                    std::optional<PushReplyTo> replyTo,
                    std::optional<Checksum256> signup = {})
   {
      auto trx = to<XKeys>().signTx(std::move(actions));
      // An empty host resolves to the node's first configured host.
      auto root = to<XHttp>().rootHost(std::string{});
      check(!root.empty(), "node has no configured host");
      auto body = psio::to_frac(trx);
      // x-http does not add Content-Length to outgoing requests
      HttpRequest request{.host        = "transact." + root,
                          .method      = "POST",
                          .target      = "/push_transaction?wait_for=final",
                          .contentType = "application/octet-stream",
                          .headers     = {{"Accept", "application/octet-stream"},
                                          {"Content-Length", std::to_string(body.size())}},
                          .body        = std::move(body)};
      auto socket = to<XHttp>().sendRequest(std::move(request), std::nullopt, nodeEndpoint());
      PSIBASE_SUBJECTIVE_TX
      {
         if (replyTo)
            to<XHttp>().autoClose(replyTo->socket, false);
         to<XHttp>().setCallback(socket, MethodNumber{"onPushReply"}, MethodNumber{"onPushError"});
         XPortal{}.open<PendingPushTable>().put(
             PendingPush{.socket = socket, .replyTo = replyTo, .signup = signup});
      }
   }

   PushResult pushResult(const HttpReply& reply)
   {
      if (reply.status != HttpStatus::ok)
         return std::string(reply.body.begin(), reply.body.end());
      auto trace = psio::from_frac<TransactionTrace>(reply.body);
      if (trace.error)
         return *trace.error;
      return trace;
   }

   TimePointUSec wallNow()
   {
      return std::chrono::time_point_cast<MicroSeconds>(std::chrono::system_clock::now());
   }

   MonotonicTimePointUSec monotonicNow()
   {
      return std::chrono::time_point_cast<MicroSeconds>(std::chrono::steady_clock::now());
   }

   void applySignupResult(const Checksum256& id, const std::string* error)
   {
      auto table = XPortal{}.open<SignupTable>();
      auto row   = table.get(id);
      check(row.has_value() && row->state == stateQueued, "signup is not queued");
      if (error)
      {
         row->state      = std::string{stateFailed};
         row->last_error = *error;
      }
      else
      {
         row->state      = std::string{stateCreated};
         row->account    = row->name;
         row->last_error = {};
      }
      row->updated = wallNow();
      table.put(*row);
   }

   void finishPush(std::int32_t socket, PushResult result)
   {
      std::optional<PendingPush> pending;
      auto*                       error = std::get_if<std::string>(&result);
      PSIBASE_SUBJECTIVE_TX
      {
         {
            auto table = XPortal{}.open<PendingPushTable>();
            pending    = table.get(socket);
            check(pending.has_value(), "no pending push on socket " + std::to_string(socket));
            table.remove(*pending);
         }
         if (pending->signup)
            applySignupResult(*pending->signup, error);
      }
      if (!pending->replyTo)
      {
         if (error && !pending->signup)
            to<XHttp>().log(LogMessage::Severity::warning, "x-portal agent push failed: " + *error);
         return;
      }
      auto& [replySocket, headers] = *pending->replyTo;
      auto reply = error ? textError(std::move(headers), HttpStatus::internalServerError, *error)
                         : jsonBody(std::move(headers), std::get<TransactionTrace>(result));
      to<XHttp>().autoClose(replySocket, true);
      to<XHttp>().sendReply(replySocket, reply);
   }

   // Enables auto-debit for ac-creator and debits the producer's pending credit
   std::vector<Action> creatorSetupActions()
   {
      transactor<Tokens>  tokens{XPortal::creatorAccount, Tokens::service};
      std::vector<Action> actions{tokens.setUserConf(Tokens::autoDebit, true)};
      auto                sys      = to<Tokens>().getSysToken();
      auto                producer = configuredProducer();
      if (sys && producer)
      {
         auto pending = to<Tokens>().getSharedBal(sys->id, *producer, XPortal::creatorAccount);
         if (pending.value != 0)
            actions.push_back(tokens.debit(sys->id, *producer, pending, "x-portal setup"));
      }
      return actions;
   }

   // Claims the one-time setup and schedules its push, unless already claimed
   void startCreatorSetupOnce()
   {
      PSIBASE_SUBJECTIVE_TX
      {
         auto table = XPortal{}.open<AgentSetupTable>();
         auto name  = std::string{XPortal::creatorAgent};
         if (!table.get(name))
         {
            table.put({name});
            to<XTimer>().runAt(monotonicNow(), MethodNumber{"creatorSetup"});
         }
      }
   }

   AdminConfig adminView(const HttpRequest& req, const PortalConfig& config)
   {
      auto key = readCreatorAgentKey();
      return AdminConfig{.requests_enabled           = config.requests_enabled,
                         .price_per_token_usd_micros = config.price_per_token_usd_micros,
                         .free_tier                  = TierView{.enabled   = config.free_tier.enabled,
                                                                .usd_cents = config.free_tier.usd_cents,
                                                                .tokens    = tierTokens(config)},
                         .producer                   = configuredProducer(),
                         .account                    = to<RTransact>().getUser(req),
                         .creator_pubkey = key ? std::optional<AuthSig::SubjectPublicKeyInfo>{key->pubkey}
                                              : std::nullopt,
                         .creator_allowed = XPortal::creatorAllowed()};
   }

   Status portalStatus(const PortalConfig& config)
   {
      auto   billing = to<VirtualServer>().is_billing_enabled();
      Status status{.requests_enabled = config.requests_enabled, .billing_enabled = billing};
      status.conditions.push_back({.id = "creator_ready", .ok = creatorReady()});
      if (billing)
         status.conditions.push_back({.id = "creator_funded", .ok = creatorFunded(config)});
      status.ready =
          std::ranges::all_of(status.conditions, [](const Condition& c) { return c.ok; });
      return status;
   }

   HttpReply serveStatus(const HttpRequest& req)
   {
      if (req.method == "OPTIONS")
         return HttpReply{.headers = cors(req)};
      if (req.method != "GET")
         return HttpReply::methodNotAllowed(req);
      auto status = portalStatus(loadedConfig());
      if (std::ranges::any_of(status.conditions, [](const Condition& condition) {
             return condition.id == "creator_ready" && condition.ok;
          }))
         startCreatorSetupOnce();
      return jsonBody(req, status);
   }

   enum class RequestsField
   {
      missing,
      invalid,
      ok,
   };

   const psio::json::any* objectField(const psio::json::any_object& object, std::string_view key)
   {
      const psio::json::any* found = nullptr;
      for (const auto& entry : object)
         if (entry.key == key)
            found = &entry.value;
      return found;
   }

   RequestsField requestsEnabled(const HttpRequest& req, bool& enabled)
   {
      auto object = psio::convert_from_json<psio::json::any_object>(
          std::string(req.body.begin(), req.body.end()));
      auto value = objectField(object, "requests_enabled");
      if (!value)
         return RequestsField::missing;
      auto flag = value->get_if<bool>();
      if (!flag)
         return RequestsField::invalid;
      enabled = *flag;
      return RequestsField::ok;
   }

   HttpReply serveAdminConfig(const HttpRequest& req, std::optional<std::int32_t> socket)
   {
      if (req.method == "OPTIONS")
         return HttpReply{.headers = cors(req)};
      if (auto reply = to<XAdmin>().checkAuth(req, socket))
         return *reply;
      if (req.method == "GET")
         return jsonBody(req, adminView(req, loadedConfig()));
      if (req.method != "PUT")
         return HttpReply::methodNotAllowed(req);
      if (req.contentType != "application/json")
         return textError(req, HttpStatus::unsupportedMediaType,
                          "Content-Type must be application/json\n");

      bool enabled = false;
      switch (requestsEnabled(req, enabled))
      {
         case RequestsField::missing:
            return textError(req, HttpStatus::badRequest, "requests_enabled is required\n");
         case RequestsField::invalid:
            return textError(req, HttpStatus::badRequest, "requests_enabled must be a boolean\n");
         case RequestsField::ok:
            break;
      }

      auto config             = loadedConfig();
      config.requests_enabled = enabled;
      writeConfig(config);
      return HttpReply{.headers = cors(req)};
   }

   HttpReply serveCreatorKeygen(const HttpRequest& req, std::optional<std::int32_t> socket)
   {
      if (req.method == "OPTIONS")
         return HttpReply{.headers = cors(req)};
      if (auto reply = to<XAdmin>().checkAuth(req, socket))
         return *reply;
      if (req.method != "POST")
         return HttpReply::methodNotAllowed(req);
      if (to<Accounts>().exists(XPortal::creatorAccount))
         return textError(req, HttpStatus::conflict, "account already exists\n");

      if (auto stored = readCreatorAgentKey())
         return jsonBody(req, *stored);

      AgentKey created{.name   = std::string{XPortal::creatorAgent},
                       .pubkey = to<XKeys>().newKey()};
      PSIBASE_SUBJECTIVE_TX
      {
         XPortal{}.open<AgentKeyTable>().put(created);
      }
      return jsonBody(req, created);
   }

   // Replies later, from the push callbacks
   std::optional<HttpReply> serveCreatorTest(const HttpRequest&          req,
                                             std::optional<std::int32_t> socket)
   {
      if (req.method == "OPTIONS")
         return HttpReply{.headers = cors(req)};
      if (auto reply = to<XAdmin>().checkAuth(req, socket))
         return reply;
      if (req.method != "POST")
         return HttpReply::methodNotAllowed(req);
      pushAgentTx(creatorSetupActions(), PushReplyTo{socket.value(), cors(req)});
      return std::nullopt;
   }

   bool validSignupName(std::string_view name)
   {
      if (name.size() < 8 || name.size() > 10)
         return false;
      if (name.front() == '-' || name.back() == '-')
         return false;
      if (name.find("--") != std::string_view::npos)
         return false;
      return std::ranges::all_of(name, [](unsigned char c) {
         return (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-';
      });
   }

   // 32 bytes encode to 43 unpadded base64url characters. The final character's
   // low 2 bits are padding and must be zero, or decoding aborts.
   std::optional<Checksum256> parseSignupId(std::string_view text)
   {
      constexpr std::string_view paddedTail = "AEIMQUYcgkosw048";
      if (text.size() != 43 || !paddedTail.contains(text.back()))
         return std::nullopt;
      for (unsigned char c : text)
      {
         if (!((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') ||
               c == '-' || c == '_'))
            return std::nullopt;
      }
      auto raw = fromBase64Url(text);
      if (raw.size() != 32)
         return std::nullopt;
      Checksum256 id{};
      std::ranges::copy(raw, id.begin());
      return id;
   }

   std::string signupId(const Checksum256& id)
   {
      return toBase64Url(std::string_view{reinterpret_cast<const char*>(id.data()), id.size()});
   }

   HttpReply serveSignup(const HttpRequest& req)
   {
      if (req.method == "OPTIONS")
         return HttpReply{.headers = cors(req)};
      if (req.method != "POST")
         return HttpReply::methodNotAllowed(req);
      if (req.contentType != "application/json")
         return textError(req, HttpStatus::unsupportedMediaType,
                          "Content-Type must be application/json\n");

      auto config = loadedConfig();
      auto status = portalStatus(config);
      if (!config.requests_enabled || !config.free_tier.enabled || !status.ready)
         return textError(req, HttpStatus::forbidden, "account requests are not open\n");

      auto object = psio::convert_from_json<psio::json::any_object>(
          std::string(req.body.begin(), req.body.end()));
      auto nameField = objectField(object, "name");
      if (!nameField)
         return textError(req, HttpStatus::badRequest, "name is required\n");
      auto name = nameField->get_if<std::string>();
      if (!name)
         return textError(req, HttpStatus::badRequest, "name must be a string\n");
      if (!validSignupName(*name))
         return textError(req, HttpStatus::badRequest, "invalid name\n");
      if (to<Accounts>().exists(AccountNumber{*name}))
         return textError(req, HttpStatus::conflict, "name is taken\n");

      auto keyField = objectField(object, "pubkey_pem");
      if (!keyField)
         return textError(req, HttpStatus::badRequest, "pubkey_pem is required\n");
      auto pem = keyField->get_if<std::string>();
      if (!pem)
         return textError(req, HttpStatus::badRequest, "pubkey_pem must be a string\n");
      if (!pem->starts_with("-----BEGIN PUBLIC KEY-----") ||
          pem->find("-----END PUBLIC KEY-----") == std::string::npos)
         return textError(req, HttpStatus::badRequest, "pubkey_pem must be a PEM public key\n");
      // parseSubjectPublicKeyInfo aborts the action. The marker check is the HTTP 400.
      (void)AuthSig::parseSubjectPublicKeyInfo(*pem);

      uint64_t usd    = 0;
      Quantity tokens = 0;
      if (status.billing_enabled)
      {
         check(config.free_tier.usd_cents.has_value(), "free tier amount is not set");
         auto grant = tierTokens(config);
         check(grant.has_value(), "free tier grant is not set");
         usd    = *config.free_tier.usd_cents;
         tokens = *grant;
      }

      Signup stored;
      PSIBASE_SUBJECTIVE_TX
      {
         Checksum256 id;
         raw::getRandom(id.data(), id.size());
         auto now = wallNow();
         stored   = Signup{.id         = id,
                           .name       = AccountNumber{*name},
                           .pubkey_pem = *pem,
                           .usd_cents  = usd,
                           .tokens     = tokens,
                           .state      = std::string{stateQueued},
                           .created    = now,
                           .updated    = now};
         XPortal{}.open<SignupTable>().put(stored);
         to<XTimer>().runAt(monotonicNow(), MethodNumber{"provision"});
      }
      return jsonBody(req, SignupReceipt{.signup_id = signupId(stored.id)});
   }

   HttpReply serveSignupStatus(const HttpRequest& req, std::string_view idText)
   {
      if (req.method == "OPTIONS")
         return HttpReply{.headers = cors(req)};
      if (req.method != "GET")
         return HttpReply::methodNotAllowed(req);
      auto id = parseSignupId(idText);
      if (!id)
         return textError(req, HttpStatus::badRequest, "invalid signup id\n");
      std::optional<Signup> stored;
      PSIBASE_SUBJECTIVE_TX
      {
         stored = XPortal{}.open<SignupTable>().get(*id);
      }
      if (!stored)
         return textError(req, HttpStatus::notFound, "signup not found\n");
      return jsonBody(req, SignupView{.state = stored->state, .account = stored->account});
   }

   struct FailedQuery
   {
      std::string state;
      PSIO_REFLECT(FailedQuery, state)
   };

   HttpReply serveFailedSignups(const HttpRequest& req, std::optional<std::int32_t> socket)
   {
      if (req.method == "OPTIONS")
         return HttpReply{.headers = cors(req)};
      if (auto reply = to<XAdmin>().checkAuth(req, socket))
         return *reply;
      if (req.method != "GET")
         return HttpReply::methodNotAllowed(req);
      if (req.query<FailedQuery>().state != stateFailed)
         return textError(req, HttpStatus::badRequest, "state must be failed\n");

      std::vector<FailedSignup> rows;
      PSIBASE_SUBJECTIVE_TX
      {
         rows.clear();
         for (auto row : XPortal{}.open<SignupTable>().getIndex<0>())
         {
            if (row.state != stateFailed)
               continue;
            rows.push_back(FailedSignup{.id         = signupId(row.id),
                                        .name       = row.name,
                                        .created    = row.created,
                                        .attempts   = row.attempts,
                                        .last_error = row.last_error});
         }
      }
      return jsonBody(req, rows);
   }

   // A queued signup is due until its one attempt is committed. The commit
   // happens before signTx, so an auth rejection does not run the attempt again.
   std::vector<Checksum256> dueSignupIds()
   {
      std::vector<Checksum256> ids;
      PSIBASE_SUBJECTIVE_TX
      {
         ids.clear();
         for (auto row : XPortal{}.open<SignupTable>().getIndex<0>())
            if (row.state == stateQueued && row.attempts == 0)
               ids.push_back(row.id);
      }
      return ids;
   }

   std::vector<Action> signupActions(const Signup& signup)
   {
      auto pubkey = AuthSig::SubjectPublicKeyInfo{AuthSig::parseSubjectPublicKeyInfo(signup.pubkey_pem)};
      transactor<AuthSig::AuthSig> auth{XPortal::creatorAccount, AuthSig::AuthSig::service};
      std::vector<Action>          actions{auth.newAccount(signup.name, std::move(pubkey))};
      if (!to<VirtualServer>().is_billing_enabled())
         return actions;

      auto sys = to<Tokens>().getSysToken();
      check(sys.has_value(), "system token is not set");
      transactor<Tokens>        tokens{XPortal::creatorAccount, Tokens::service};
      transactor<VirtualServer> vserver{XPortal::creatorAccount, VirtualServer::service};
      actions.push_back(tokens.credit(sys->id, VirtualServer::service, signup.tokens, signupMemo));
      actions.push_back(vserver.buy_res_for(signup.tokens, signup.name, signupMemo));
      return actions;
   }

   void provisionSignup(const Checksum256& id)
   {
      std::optional<Signup> claimed;
      PSIBASE_SUBJECTIVE_TX
      {
         claimed.reset();
         auto table = XPortal{}.open<SignupTable>();
         if (auto row = table.get(id); row && row->state == stateQueued && row->attempts == 0)
         {
            row->attempts += 1;
            row->last_error = std::string{signingAborted};
            row->updated    = wallNow();
            table.put(*row);
            claimed = *row;
         }
      }
      // Already attempted, or no longer queued: a later timer is not another attempt.
      if (!claimed)
         return;
      pushAgentTx(signupActions(*claimed), std::nullopt, claimed->id);
   }
}  // namespace

std::optional<HttpReply> XPortal::serveSys(HttpRequest                 request,
                                           std::optional<std::int32_t> socket,
                                           std::optional<AccountNumber> /*user*/)
{
   check(getSender() == XHttp::service, "Wrong sender");
   auto target = request.path();
   if (target == "/status")
      return serveStatus(request);
   if (target == "/admin/config")
      return serveAdminConfig(request, socket);
   if (target == "/admin/agents/creator/keygen")
      return serveCreatorKeygen(request, socket);
   if (target == "/admin/agents/creator/test")
      return serveCreatorTest(request, socket);
   if (target == "/admin/signups")
      return serveFailedSignups(request, socket);
   if (target == "/signup")
      return serveSignup(request);
   if (target.starts_with("/signup/"))
      return serveSignupStatus(request, std::string_view{target}.substr(8));
   return std::nullopt;
}

void XPortal::creatorSetup(std::uint64_t /*timer*/)
{
   check(getSender() == XTimer::service, "Wrong sender");
   pushAgentTx(creatorSetupActions(), std::nullopt);
}

void XPortal::provision(std::uint64_t /*timer*/)
{
   check(getSender() == XTimer::service, "Wrong sender");
   for (const auto& id : dueSignupIds())
      provisionSignup(id);
}

void XPortal::onPushReply(std::int32_t socket, HttpReply reply)
{
   check(getSender() == XHttp::service, "Wrong sender");
   finishPush(socket, pushResult(reply));
}

void XPortal::onPushError(std::int32_t socket)
{
   check(getSender() == XHttp::service, "Wrong sender");
   finishPush(socket, std::string{"transact sent no reply"});
}

PSIBASE_DISPATCH(XPortal)
