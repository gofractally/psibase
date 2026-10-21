#include <services/local/XPortal.hpp>

#include <algorithm>
#include <array>
#include <chrono>
#include <format>
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
#include <services/user/Invite.hpp>
#include <services/user/Tokens.hpp>
#include <tuple>

using namespace psibase;
using namespace LocalService;
using namespace SystemService;
using namespace UserService;
using UserService::InviteNs::Invite;
using UserService::InviteNs::InvPayload;

namespace
{
   constexpr uint64_t seedUsdMicros    = 2'500'000;
   constexpr uint64_t freeTierUsdCents = 250;

   constexpr std::string_view stateQueued    = "queued";
   constexpr std::string_view stateInvited   = "invited";
   constexpr std::string_view stateFailed    = "failed";
   constexpr std::string_view signingAborted = "signing aborted";
   constexpr char              signupMemo[]  = "x-portal signup";

   constexpr std::string_view xAuthorizeUrl  = "https://x.com/i/oauth2/authorize";
   constexpr std::string_view xScope         = "users.read tweet.read";
   constexpr std::string_view sessionCookie  = "XPORTAL_SESSION";
   constexpr auto             authRequestTtl = std::chrono::minutes{10};
   constexpr auto             sessionTtl     = std::chrono::days{7};

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

   bool creatorTokens(const PortalConfig& config)
   {
      auto grant = tierTokens(config);
      check(grant.has_value(), "free tier grant is not set");
      auto sys = to<Tokens>().getSysToken();
      check(sys.has_value(), "system token is not set");
      auto cost    = to<Invite>().getInvCost(1, *grant);
      auto balance = to<Tokens>().getBalance(sys->id, XPortal::creatorAccount);
      return balance.value >= cost.value;
   }

   bool creatorResources()
   {
      return resourceBuffer(XPortal::creatorAccount).value > 0;
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

   // Signs `actions` with x-portal's x-keys keys and sends them to this node's
   // `transact`, then updates `signup` when the push completes.
   //
   // `signTx` aborts the caller when the signing account's auth rejects the
   // actions, so callers commit any attempt bookkeeping before calling this.
   void pushAgentTx(std::vector<Action> actions, Checksum256 signup)
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
         to<XHttp>().setCallback(socket, MethodNumber{"onPushReply"}, MethodNumber{"onPushError"});
         XPortal{}.open<PendingPushTable>().put(PendingPush{.socket = socket, .signup = signup});
      }
   }

   std::optional<std::string> pushError(const HttpReply& reply)
   {
      if (reply.status != HttpStatus::ok)
         return std::string(reply.body.begin(), reply.body.end());
      auto trace = psio::from_frac<TransactionTrace>(reply.body);
      if (trace.error)
         return *trace.error;
      return std::nullopt;
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
         row->state      = std::string{stateInvited};
         row->last_error = {};
      }
      row->updated = wallNow();
      table.put(*row);
   }

   void finishPush(std::int32_t socket, std::optional<std::string> error)
   {
      std::optional<PendingPush> pending;
      PSIBASE_SUBJECTIVE_TX
      {
         {
            auto table = XPortal{}.open<PendingPushTable>();
            pending    = table.get(socket);
            check(pending.has_value(), "no pending push on socket " + std::to_string(socket));
            table.remove(*pending);
         }
         applySignupResult(pending->signup, error ? &*error : nullptr);
      }
   }

   bool xConfigured(const XConfig& x)
   {
      return x.client_id && x.client_secret;
   }

   XConfig maskedX(XConfig x)
   {
      if (x.client_secret)
      {
         auto& secret = *x.client_secret;
         x.client_secret =
             std::string{secret.substr(secret.size() - std::min<std::size_t>(secret.size(), 4))};
      }
      return x;
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
                         .creator_allowed = XPortal::creatorAllowed(),
                         .x               = maskedX(config.x)};
   }

   Status portalStatus(const PortalConfig& config)
   {
      auto   billing = to<VirtualServer>().is_billing_enabled();
      Status status{.requests_enabled = config.requests_enabled, .billing_enabled = billing};
      status.conditions.push_back({.id = "creator_ready", .ok = creatorReady()});
      if (billing)
      {
         status.conditions.push_back({.id = "creator_tokens", .ok = creatorTokens(config)});
         status.conditions.push_back({.id = "creator_resources", .ok = creatorResources()});
      }
      status.ready =
          std::ranges::all_of(status.conditions, [](const Condition& c) { return c.ok; });
      status.conditions.push_back({.id = "x_configured", .ok = xConfigured(config.x)});
      return status;
   }

   HttpReply serveStatus(const HttpRequest& req)
   {
      if (req.method == "OPTIONS")
         return HttpReply{.headers = cors(req)};
      if (req.method != "GET")
         return HttpReply::methodNotAllowed(req);
      return jsonBody(req, portalStatus(loadedConfig()));
   }

   const psio::json::any* objectField(const psio::json::any_object& object, std::string_view key)
   {
      const psio::json::any* found = nullptr;
      for (const auto& entry : object)
         if (entry.key == key)
            found = &entry.value;
      return found;
   }

   // Sets `out` when `key` is present. Returns the 400 message when its value
   // is not a non-empty string.
   std::optional<std::string> readXField(const psio::json::any_object& object,
                                         std::string_view              key,
                                         std::optional<std::string>&   out)
   {
      auto value = objectField(object, key);
      if (!value)
         return std::nullopt;
      auto text = value->get_if<std::string>();
      if (!text || text->empty())
         return std::format("x.{} must be a non-empty string\n", key);
      out = *text;
      return std::nullopt;
   }

   std::optional<std::string> updateX(const psio::json::any& value, XConfig& x)
   {
      auto fields = value.get_if<psio::json::any_object>();
      if (!fields)
         return "x must be an object\n";
      if (auto error = readXField(*fields, "client_id", x.client_id))
         return error;
      if (auto error = readXField(*fields, "client_secret", x.client_secret))
         return error;
      std::optional<std::string> apiBase;
      if (auto error = readXField(*fields, "api_base", apiBase))
         return error;
      if (apiBase)
      {
         auto origin = splitURL(*apiBase);
         if (origin.scheme.empty() || origin.host.empty() || origin.path != "/" ||
             apiBase->ends_with('/'))
            return "x.api_base must be an http or https origin\n";
         x.api_base = *apiBase;
      }
      return std::nullopt;
   }

   // Applies a `PUT /admin/config` body to `config`. Returns the 400 message
   // when the body sets nothing or a field has the wrong type.
   std::optional<std::string> updateConfig(const HttpRequest& req, PortalConfig& config)
   {
      auto object = psio::convert_from_json<psio::json::any_object>(
          std::string(req.body.begin(), req.body.end()));
      auto requests = objectField(object, "requests_enabled");
      auto x        = objectField(object, "x");
      if (!requests && !x)
         return "requests_enabled or x is required\n";
      if (requests)
      {
         auto flag = requests->get_if<bool>();
         if (!flag)
            return "requests_enabled must be a boolean\n";
         config.requests_enabled = *flag;
      }
      if (x)
         return updateX(*x, config.x);
      return std::nullopt;
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

      auto config = loadedConfig();
      if (auto error = updateConfig(req, config))
         return textError(req, HttpStatus::badRequest, *error);
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

   std::optional<XSession> currentSession(const HttpRequest& req)
   {
      std::optional<XSession> session;
      PSIBASE_SUBJECTIVE_TX
      {
         auto table = XPortal{}.open<XSessionTable>();
         for (auto id : req.getCookie(sessionCookie))
         {
            auto row = table.get(std::string{id});
            if (!row)
               continue;
            if (row->expires <= wallNow())
            {
               table.remove(*row);
               continue;
            }
            session = std::move(row);
            break;
         }
      }
      return session;
   }

   std::optional<XSession> requireSession(const HttpRequest& req, HttpReply& denied)
   {
      if (auto session = currentSession(req))
         return session;
      denied = textError(req, HttpStatus::unauthorized, "not signed in\n");
      return std::nullopt;
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

      HttpReply denied;
      auto      session = requireSession(req, denied);
      if (!session)
         return denied;

      auto config = loadedConfig();
      auto status = portalStatus(config);
      if (!config.requests_enabled || !config.free_tier.enabled || !status.ready)
         return textError(req, HttpStatus::forbidden, "account requests are not open\n");

      // A struct, not psio::json::any, because any rejects JSON numbers. A
      // wrongly typed field aborts.
      auto body = psio::convert_from_json<SignupBody>(std::string(req.body.begin(), req.body.end()));
      if (!body.invite_id)
         return textError(req, HttpStatus::badRequest, "invite_id is required\n");
      if (!body.payload)
         return textError(req, HttpStatus::badRequest, "payload is required\n");
      if (!body.token)
         return textError(req, HttpStatus::badRequest, "token is required\n");
      if (body.tier)
         return textError(req, HttpStatus::badRequest, "tier is not supported\n");
      if (!psio::fracpack_validate_strict<InvPayload>(
              {reinterpret_cast<const char*>(body.payload->data()), body.payload->size()}))
         return textError(req, HttpStatus::badRequest, "payload is not an invite payload\n");
      if (to<Invite>().getInvite(*body.invite_id))
         return textError(req, HttpStatus::conflict, "invite id is taken\n");

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

      std::optional<Signup> stored;
      PSIBASE_SUBJECTIVE_TX
      {
         stored.reset();
         auto table = XPortal{}.open<SignupTable>();
         bool taken = false;
         for (auto row : table.getIndex<0>())
         {
            if (row.x_id && *row.x_id == session->x_id && !row.tier && row.state != stateFailed)
            {
               taken = true;
               break;
            }
         }
         if (!taken)
         {
            Checksum256 id;
            raw::getRandom(id.data(), id.size());
            auto now = wallNow();
            stored   = Signup{.id        = id,
                              .invite_id = *body.invite_id,
                              .payload   = *body.payload,
                              .token     = *body.token,
                              .usd_cents = usd,
                              .tokens    = tokens,
                              .state     = std::string{stateQueued},
                              .created   = now,
                              .updated   = now,
                              .x_id      = session->x_id};
            table.put(*stored);
            to<XTimer>().runAt(monotonicNow(), MethodNumber{"provision"});
         }
      }
      if (!stored)
         return textError(req, HttpStatus::conflict, "free signup already exists\n");
      return jsonBody(req, SignupReceipt{.signup_id = signupId(stored->id)});
   }

   HttpReply serveSignupStatus(const HttpRequest& req, std::string_view idText)
   {
      if (req.method == "OPTIONS")
         return HttpReply{.headers = cors(req)};
      if (req.method != "GET")
         return HttpReply::methodNotAllowed(req);
      HttpReply denied;
      auto      session = requireSession(req, denied);
      if (!session)
         return denied;
      auto id = parseSignupId(idText);
      if (!id)
         return textError(req, HttpStatus::badRequest, "invalid signup id\n");
      std::optional<Signup> stored;
      PSIBASE_SUBJECTIVE_TX
      {
         stored = XPortal{}.open<SignupTable>().get(*id);
      }
      if (!stored || !stored->x_id || *stored->x_id != session->x_id)
         return textError(req, HttpStatus::notFound, "signup not found\n");
      SignupView view{.state = stored->state};
      if (stored->state == stateInvited)
         view.token = stored->token;
      return jsonBody(req, view);
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
                                        .created    = row.created,
                                        .attempts   = row.attempts,
                                        .last_error = row.last_error});
         }
      }
      return jsonBody(req, rows);
   }

   std::string randomToken()
   {
      Checksum256 id{};
      raw::getRandom(id.data(), id.size());
      return signupId(id);
   }

   std::string codeChallenge(std::string_view verifier)
   {
      auto hash = sha256(verifier.data(), verifier.size());
      return toBase64Url({reinterpret_cast<const char*>(hash.data()), hash.size()});
   }

   // `key=value&...` with every character outside RFC 3986's unreserved set
   // percent-encoded. Serves both query strings and form bodies.
   std::string formEncode(
       std::initializer_list<std::pair<std::string_view, std::string_view>> fields)
   {
      constexpr std::string_view hex = "0123456789ABCDEF";
      std::string                out;
      auto                       append = [&](std::string_view text)
      {
         for (unsigned char c : text)
         {
            if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') ||
                c == '-' || c == '.' || c == '_' || c == '~')
            {
               out += c;
            }
            else
            {
               out += '%';
               out += hex[c >> 4];
               out += hex[c & 0xf];
            }
         }
      };
      for (const auto& [key, value] : fields)
      {
         if (!out.empty())
            out += '&';
         append(key);
         out += '=';
         append(value);
      }
      return out;
   }

   // Off localhost this is the canonical https origin. A localhost node serves
   // plain http, so the URL keeps that scheme and the request's port.
   std::string xCallbackUrl(const HttpRequest& req)
   {
      bool        local = isLocalhost(req);
      std::string url   = local ? "http://" : "https://";
      url += XPortal::service.str();
      url += '.';
      url += to<XHttp>().rootHost(req.host);
      if (auto host = req.getHeader("host"); local && host)
      {
         if (auto pos = host->rfind(':'); pos != std::string_view::npos)
            url += host->substr(pos);
      }
      url += "/auth/x/callback";
      return url;
   }

   HttpReply redirect(std::string location, std::vector<HttpHeader> headers = {})
   {
      headers.push_back({"Location", std::move(location)});
      return HttpReply{.status = HttpStatus::found, .headers = std::move(headers)};
   }

   HttpHeader sessionCookieHeader(std::string_view value, std::chrono::seconds maxAge, bool secure)
   {
      auto cookie = std::format("{}={}; Path=/; Max-Age={}; HttpOnly; SameSite=Lax", sessionCookie,
                                value, maxAge.count());
      if (secure)
         cookie += "; Secure";
      return {"Set-Cookie", std::move(cookie)};
   }

   HttpReply serveXStart(const HttpRequest& req)
   {
      if (req.method != "GET")
         return HttpReply::methodNotAllowed(req);
      auto x = readConfig().x;
      if (!xConfigured(x))
         return textError(req, HttpStatus::serviceUnavailable,
                          "Sign in with X is not configured\n");

      auto         now = wallNow();
      XAuthRequest started{.state         = randomToken(),
                           .code_verifier = randomToken(),
                           .redirect_uri  = xCallbackUrl(req),
                           .expires       = now + authRequestTtl};
      PSIBASE_SUBJECTIVE_TX
      {
         auto                      table = XPortal{}.open<XAuthRequestTable>();
         std::vector<XAuthRequest> expired;
         for (auto row : table.getIndex<1>())
         {
            if (row.expires > now)
               break;
            expired.push_back(std::move(row));
         }
         for (const auto& row : expired)
            table.remove(row);
         table.put(started);
      }
      auto query = formEncode({{"response_type", "code"},
                               {"client_id", *x.client_id},
                               {"redirect_uri", started.redirect_uri},
                               {"scope", xScope},
                               {"state", started.state},
                               {"code_challenge", codeChallenge(started.code_verifier)},
                               {"code_challenge_method", "S256"}});
      return redirect(std::format("{}?{}", xAuthorizeUrl, query));
   }

   HttpRequest xTokenRequest(const XConfig& x, std::string_view code, const XAuthRequest& started)
   {
      auto body        = formEncode({{"grant_type", "authorization_code"},
                                     {"code", code},
                                     {"redirect_uri", started.redirect_uri},
                                     {"code_verifier", started.code_verifier}});
      auto credentials = *x.client_id + ":" + *x.client_secret;
      // x-http does not add Content-Length to outgoing requests
      return HttpRequest{.method      = "POST",
                         .target      = "/2/oauth2/token",
                         .contentType = "application/x-www-form-urlencoded",
                         .headers     = {{"Authorization", "Basic " + toBase64(credentials)},
                                         {"Content-Length", std::to_string(body.size())}},
                         .body        = std::vector<char>(body.begin(), body.end())};
   }

   HttpRequest xUserRequest(std::string_view accessToken)
   {
      return HttpRequest{.method  = "GET",
                         .target  = "/2/users/me",
                         .headers = {{"Authorization", std::format("Bearer {}", accessToken)}}};
   }

   // Sends `request` to the host of `x.api_base`, over TLS when it is https.
   void sendXRequest(const XConfig&  x,
                     HttpRequest     request,
                     MethodNumber    callback,
                     PendingXRequest pending)
   {
      auto origin  = splitURL(x.api_base);
      request.host = std::string{origin.host};
      std::optional<TLSInfo> tls;
      if (origin.scheme == "https")
         tls.emplace();
      pending.socket = to<XHttp>().sendRequest(std::move(request), tls, std::nullopt);
      PSIBASE_SUBJECTIVE_TX
      {
         to<XHttp>().setCallback(pending.socket, callback, MethodNumber{"onXError"});
         XPortal{}.open<PendingXRequestTable>().put(pending);
      }
   }

   PendingXRequest takePendingXRequest(std::int32_t socket)
   {
      std::optional<PendingXRequest> pending;
      PSIBASE_SUBJECTIVE_TX
      {
         auto table = XPortal{}.open<PendingXRequestTable>();
         pending    = table.get(socket);
         check(pending.has_value(), "no pending X request on socket " + std::to_string(socket));
         table.remove(*pending);
      }
      return *pending;
   }

   void replyToBrowser(const PendingXRequest& pending, const HttpReply& reply)
   {
      PSIBASE_SUBJECTIVE_TX
      {
         to<XHttp>().autoClose(pending.client, true);
         to<XHttp>().sendReply(pending.client, reply);
      }
   }

   HttpReply xFailure(std::string_view message)
   {
      return textError(std::vector<HttpHeader>{}, HttpStatus::badGateway, message);
   }

   struct XCallbackQuery
   {
      std::string code;
      std::string state;
      PSIO_REFLECT(XCallbackQuery, code, state)
   };

   std::optional<HttpReply> serveXCallback(const HttpRequest&          req,
                                           std::optional<std::int32_t> socket)
   {
      if (req.method != "GET")
         return HttpReply::methodNotAllowed(req);
      auto                        query = req.query<XCallbackQuery>();
      std::optional<XAuthRequest> started;
      PSIBASE_SUBJECTIVE_TX
      {
         auto table = XPortal{}.open<XAuthRequestTable>();
         started    = table.get(query.state);
         if (started)
            table.remove(*started);
      }
      if (!started || started->expires <= wallNow())
         return textError(req, HttpStatus::badRequest, "unknown or expired sign-in state\n");
      // X returns `error` instead of `code` when the user cancels.
      if (query.code.empty())
         return redirect("/");
      auto x = readConfig().x;
      if (!xConfigured(x))
         return textError(req, HttpStatus::serviceUnavailable,
                          "Sign in with X is not configured\n");

      sendXRequest(x, xTokenRequest(x, query.code, *started), MethodNumber{"onXToken"},
                   PendingXRequest{.client = *socket, .secure = !isLocalhost(req)});
      PSIBASE_SUBJECTIVE_TX
      {
         to<XHttp>().autoClose(*socket, false);
      }
      return std::nullopt;
   }

   struct XTokenReply
   {
      std::optional<std::string> access_token;
      PSIO_REFLECT(XTokenReply, access_token)
   };

   struct XUserData
   {
      std::string id;
      std::string username;
      PSIO_REFLECT(XUserData, id, username)
   };

   struct XUserReply
   {
      std::optional<XUserData> data;
      PSIO_REFLECT(XUserReply, data)
   };

   template <typename T>
   T parseXReply(const HttpReply& reply)
   {
      return psio::convert_from_json<T>(std::string(reply.body.begin(), reply.body.end()));
   }

   void finishSignIn(const PendingXRequest& pending, const XUserData& user)
   {
      XSession session{.session_id = randomToken(),
                       .x_id       = user.id,
                       .handle     = user.username,
                       .expires    = wallNow() + sessionTtl};
      PSIBASE_SUBJECTIVE_TX
      {
         XPortal{}.open<XUserTable>().put(XUser{.x_id = user.id, .handle = user.username});
         XPortal{}.open<XSessionTable>().put(session);
      }
      replyToBrowser(
          pending,
          redirect("/", {sessionCookieHeader(session.session_id, sessionTtl, pending.secure)}));
   }

   HttpReply serveMe(const HttpRequest& req)
   {
      if (req.method == "OPTIONS")
         return HttpReply{.headers = cors(req)};
      if (req.method != "GET")
         return HttpReply::methodNotAllowed(req);
      HttpReply denied;
      auto      session = requireSession(req, denied);
      if (!session)
         return denied;
      return jsonBody(req, XIdentity{.x_id = session->x_id, .handle = session->handle});
   }

   HttpReply serveLogout(const HttpRequest& req)
   {
      if (req.method == "OPTIONS")
         return HttpReply{.headers = cors(req)};
      if (req.method != "POST")
         return HttpReply::methodNotAllowed(req);
      PSIBASE_SUBJECTIVE_TX
      {
         auto table = XPortal{}.open<XSessionTable>();
         for (auto id : req.getCookie(sessionCookie))
            if (auto row = table.get(std::string{id}))
               table.remove(*row);
      }
      auto headers = cors(req);
      headers.push_back(sessionCookieHeader("", std::chrono::seconds{0}, !isLocalhost(req)));
      return HttpReply{.headers = std::move(headers)};
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
      std::vector<Action>     actions;
      Quantity                cost;
      std::optional<Quantity> subsidy;
      if (to<VirtualServer>().is_billing_enabled())
      {
         auto sys = to<Tokens>().getSysToken();
         check(sys.has_value(), "system token is not set");
         cost    = to<Invite>().getInvCost(1, signup.tokens);
         subsidy = signup.tokens;
         transactor<Tokens> tokens{XPortal::creatorAccount, Tokens::service};
         actions.push_back(tokens.credit(sys->id, Invite::service, cost, signupMemo));
      }
      transactor<Invite> invite{XPortal::creatorAccount, Invite::service};
      actions.push_back(invite.createInvite(signup.invite_id, signup.payload, 1, false, cost, subsidy));
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
      pushAgentTx(signupActions(*claimed), claimed->id);
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
   if (target == "/admin/signups")
      return serveFailedSignups(request, socket);
   if (target == "/signup")
      return serveSignup(request);
   if (target.starts_with("/signup/"))
      return serveSignupStatus(request, std::string_view{target}.substr(8));
   if (target == "/auth/x/start")
      return serveXStart(request);
   if (target == "/auth/x/callback")
      return serveXCallback(request, socket);
   if (target == "/auth/logout")
      return serveLogout(request);
   if (target == "/me")
      return serveMe(request);
   return std::nullopt;
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
   finishPush(socket, pushError(reply));
}

void XPortal::onPushError(std::int32_t socket)
{
   check(getSender() == XHttp::service, "Wrong sender");
   finishPush(socket, std::string{"transact sent no reply"});
}

void XPortal::onXToken(std::int32_t socket, HttpReply reply)
{
   check(getSender() == XHttp::service, "Wrong sender");
   auto pending = takePendingXRequest(socket);
   if (reply.status != HttpStatus::ok)
      return replyToBrowser(pending, xFailure("X rejected the sign-in code\n"));
   auto token = parseXReply<XTokenReply>(reply).access_token;
   if (!token)
      return replyToBrowser(pending, xFailure("X sent no access token\n"));
   sendXRequest(readConfig().x, xUserRequest(*token), MethodNumber{"onXUser"}, pending);
}

void XPortal::onXUser(std::int32_t socket, HttpReply reply)
{
   check(getSender() == XHttp::service, "Wrong sender");
   auto                     pending = takePendingXRequest(socket);
   std::optional<XUserData> user;
   if (reply.status == HttpStatus::ok)
      user = parseXReply<XUserReply>(reply).data;
   if (!user || user->id.empty() || user->username.empty())
      return replyToBrowser(pending, xFailure("X did not return the signed-in user\n"));
   finishSignIn(pending, *user);
}

void XPortal::onXError(std::int32_t socket)
{
   check(getSender() == XHttp::service, "Wrong sender");
   replyToBrowser(takePendingXRequest(socket), xFailure("X did not respond\n"));
}

PSIBASE_DISPATCH(XPortal)
