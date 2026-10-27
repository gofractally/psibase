#include <services/local/XPortal.hpp>

#include <algorithm>
#include <array>
#include <charconv>
#include <chrono>
#include <format>
#include <limits>
#include <psibase/base64.hpp>
#include <psibase/dispatch.hpp>
#include <psibase/HttpHeaders.hpp>
#include <psibase/nativeTables.hpp>
#include <psibase/trace.hpp>
#include <psio/json/any.hpp>
#include <psio/to_hex.hpp>
#include <ranges>
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

   constexpr std::string_view statePending   = "pending";
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

   constexpr auto webhookTolerance = std::chrono::minutes{5};

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

   Quantity tokensAtPrice(const PortalConfig& config, uint64_t usdCents)
   {
      check(config.price_per_token_usd_micros.has_value(), "token price is not set");
      auto token = to<Tokens>().getSysToken();
      check(token.has_value(), "system token is not set");
      return tokensFor(usdCents, *config.price_per_token_usd_micros, token->precision.value);
   }

   std::optional<Quantity> freeTierTokens(const PortalConfig& config)
   {
      if (!config.price_per_token_usd_micros || !config.free_tier.usd_cents)
         return std::nullopt;
      return tokensAtPrice(config, *config.free_tier.usd_cents);
   }

   // While billing is disabled, a free signup is charged and granted nothing.
   TierOffer freeOffer(const PortalConfig& config, bool billing)
   {
      if (!billing)
         return {};
      check(config.free_tier.usd_cents.has_value(), "free tier amount is not set");
      auto usd = *config.free_tier.usd_cents;
      return {.usd_cents = usd, .tokens = tokensAtPrice(config, usd)};
   }

   // The paid tier `POST /signup` sells, or null when none is offered.
   const PaidTier* offeredPaidTier(const PortalConfig& config, bool billing)
   {
      if (!billing || config.tiers.empty())
         return nullptr;
      return &config.tiers.front();
   }

   TierOffer paidOffer(const PortalConfig& config, const PaidTier& tier)
   {
      return {.usd_cents = tier.usd_cents, .tokens = tokensAtPrice(config, tier.usd_cents)};
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
      auto grant = freeTierTokens(config);
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
         XPortal{}.open<ProvisionAttemptTable>().erase(pending->signup);
      }
   }

   bool xConfigured(const XConfig& x)
   {
      return x.client_id && x.client_secret;
   }

   const StripeKeys& activeStripe(const PortalConfig& config)
   {
      if (config.mode == "production")
         return config.stripe.production;
      check(config.mode == "sandbox", "unknown Stripe mode " + config.mode);
      return config.stripe.sandbox;
   }

   bool stripeConfigured(const StripeKeys& keys)
   {
      return keys.secret_key && keys.publishable_key && keys.webhook_secret;
   }

   void maskSecret(std::optional<std::string>& secret)
   {
      if (secret)
         *secret = secret->substr(secret->size() - std::min<std::size_t>(secret->size(), 4));
   }

   XConfig maskedX(XConfig x)
   {
      maskSecret(x.client_secret);
      return x;
   }

   StripeConfig maskedStripe(StripeConfig stripe)
   {
      maskSecret(stripe.sandbox.secret_key);
      maskSecret(stripe.sandbox.webhook_secret);
      maskSecret(stripe.production.secret_key);
      maskSecret(stripe.production.webhook_secret);
      return stripe;
   }

   std::string xCallbackUrl(const HttpRequest& req, bool tls)
   {
      std::string host = XPortal::service.str();
      host += '.';
      host += to<XHttp>().rootHost(req.host);
      return publicUrl(req, tls, host, "/auth/x/callback");
   }

   AdminConfig adminView(const HttpRequest& req, const PortalConfig& config, bool tls)
   {
      auto key = readCreatorAgentKey();
      return AdminConfig{.requests_enabled           = config.requests_enabled,
                         .price_per_token_usd_micros = config.price_per_token_usd_micros,
                         .free_tier                  = TierView{.enabled   = config.free_tier.enabled,
                                                                .usd_cents = config.free_tier.usd_cents,
                                                                .tokens    = freeTierTokens(config)},
                         .producer                   = configuredProducer(),
                         .account                    = to<RTransact>().getUser(req),
                         .creator_pubkey = key ? std::optional<AuthSig::SubjectPublicKeyInfo>{key->pubkey}
                                              : std::nullopt,
                         .creator_allowed = XPortal::creatorAllowed(),
                         .x               = maskedX(config.x),
                         .x_callback_url  = xCallbackUrl(req, tls),
                         .mode            = config.mode,
                         .stripe          = maskedStripe(config.stripe),
                         .tiers           = config.tiers};
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
      status.conditions.push_back({.id = "x_configured", .ok = xConfigured(config.x)});
      status.conditions.push_back(
          {.id = "stripe_configured", .ok = stripeConfigured(activeStripe(config))});
      auto paidOffered = offeredPaidTier(config, billing) != nullptr;
      status.ready     = std::ranges::all_of(
          status.conditions,
          [&](const Condition& c)
          {
             if (c.id == "x_configured")
                return true;
             if (c.id == "stripe_configured")
                return c.ok || !paidOffered;
             return c.ok;
          });
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

   HttpReply serveTiers(const HttpRequest& req)
   {
      if (req.method == "OPTIONS")
         return HttpReply{.headers = cors(req)};
      if (req.method != "GET")
         return HttpReply::methodNotAllowed(req);
      auto       config  = loadedConfig();
      auto       billing = to<VirtualServer>().is_billing_enabled();
      TierOffers offers;
      if (config.free_tier.enabled)
         offers.free = freeOffer(config, billing);
      if (auto tier = offeredPaidTier(config, billing))
      {
         auto offer = paidOffer(config, *tier);
         offers.tiers.push_back({.index     = 0,
                                 .label     = tier->label,
                                 .usd_cents = offer.usd_cents,
                                 .tokens    = offer.tokens});
      }
      return jsonBody(req, offers);
   }

   const psio::json::any* objectField(const psio::json::any_object& object, std::string_view key)
   {
      const psio::json::any* found = nullptr;
      for (const auto& entry : object)
         if (entry.key == key)
            found = &entry.value;
      return found;
   }

   // Sets `out` when `key` is present. Returns the 400 message, naming the
   // field `<path>.<key>`, when its value is not a non-empty string.
   std::optional<std::string> readStringField(const psio::json::any_object& object,
                                              std::string_view              path,
                                              std::string_view              key,
                                              std::optional<std::string>&   out)
   {
      auto value = objectField(object, key);
      if (!value)
         return std::nullopt;
      auto text = value->get_if<std::string>();
      if (!text || text->empty())
         return std::format("{}.{} must be a non-empty string\n", path, key);
      out = *text;
      return std::nullopt;
   }

   // Sets `apiBase` when `api_base` is present. Returns the 400 message when
   // it is not an http or https origin.
   std::optional<std::string> readApiBase(const psio::json::any_object& object,
                                          std::string_view              path,
                                          std::string&                  apiBase)
   {
      std::optional<std::string> value;
      if (auto error = readStringField(object, path, "api_base", value))
         return error;
      if (value)
      {
         auto origin = splitURL(*value);
         if (origin.scheme.empty() || origin.host.empty() || origin.path != "/" ||
             value->ends_with('/'))
            return std::format("{}.api_base must be an http or https origin\n", path);
         apiBase = *value;
      }
      return std::nullopt;
   }

   std::optional<std::string> updateX(const psio::json::any& value, XConfig& x)
   {
      auto fields = value.get_if<psio::json::any_object>();
      if (!fields)
         return "x must be an object\n";
      if (auto error = readStringField(*fields, "x", "client_id", x.client_id))
         return error;
      if (auto error = readStringField(*fields, "x", "client_secret", x.client_secret))
         return error;
      return readApiBase(*fields, "x", x.api_base);
   }

   std::optional<std::string> updateStripeKeys(const psio::json::any& value,
                                               std::string_view       path,
                                               StripeKeys&            keys)
   {
      auto fields = value.get_if<psio::json::any_object>();
      if (!fields)
         return std::format("{} must be an object\n", path);
      if (auto error = readStringField(*fields, path, "secret_key", keys.secret_key))
         return error;
      if (auto error = readStringField(*fields, path, "publishable_key", keys.publishable_key))
         return error;
      if (auto error = readStringField(*fields, path, "webhook_secret", keys.webhook_secret))
         return error;
      return readApiBase(*fields, path, keys.api_base);
   }

   std::optional<std::string> updateStripe(const psio::json::any& value, StripeConfig& stripe)
   {
      auto fields = value.get_if<psio::json::any_object>();
      if (!fields)
         return "stripe must be an object\n";
      if (auto sandbox = objectField(*fields, "sandbox"))
         if (auto error = updateStripeKeys(*sandbox, "stripe.sandbox", stripe.sandbox))
            return error;
      if (auto production = objectField(*fields, "production"))
         return updateStripeKeys(*production, "stripe.production", stripe.production);
      return std::nullopt;
   }

   // A wrongly typed tier field aborts.
   std::optional<std::string> updateTiers(const psio::json::any& value, std::vector<PaidTier>& tiers)
   {
      if (!value.get_if<psio::json::any_array>())
         return "tiers must be an array\n";
      auto parsed = psio::convert_from_json<std::vector<PaidTier>>(psio::convert_to_json(value));
      for (const auto& tier : parsed)
         if (tier.label.empty() || tier.usd_cents == 0)
            return "each tier needs a label and a positive usd_cents\n";
      tiers = std::move(parsed);
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
      auto stripe   = objectField(object, "stripe");
      auto tiers    = objectField(object, "tiers");
      if (!requests && !x && !stripe && !tiers)
         return "requests_enabled, x, stripe, or tiers is required\n";
      if (requests)
      {
         auto flag = requests->get_if<bool>();
         if (!flag)
            return "requests_enabled must be a boolean\n";
         config.requests_enabled = *flag;
      }
      if (x)
         if (auto error = updateX(*x, config.x))
            return error;
      if (stripe)
         if (auto error = updateStripe(*stripe, config.stripe))
            return error;
      if (tiers)
         return updateTiers(*tiers, config.tiers);
      return std::nullopt;
   }

   HttpReply serveAdminConfig(const HttpRequest& req, std::optional<std::int32_t> socket)
   {
      if (req.method == "OPTIONS")
         return HttpReply{.headers = cors(req)};
      if (auto reply = to<XAdmin>().checkAuth(req, socket))
         return *reply;
      if (req.method == "GET")
      {
         bool tls = socket && to<XHttp>().isSecure(*socket);
         return jsonBody(req, adminView(req, loadedConfig(), tls));
      }
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

   // Sends `request` to the host of `apiBase`, over TLS when it is https.
   // Returns the socket x-http calls back on.
   std::int32_t sendToApi(std::string_view apiBase, HttpRequest request)
   {
      auto origin  = splitURL(apiBase);
      request.host = std::string{origin.host};
      std::optional<TLSInfo> tls;
      if (origin.scheme == "https")
         tls.emplace();
      return to<XHttp>().sendRequest(std::move(request), tls, std::nullopt);
   }

   HttpRequest checkoutSessionRequest(const StripeKeys& keys,
                                      const PaidTier&   tier,
                                      const Signup&     signup)
   {
      auto amount = std::to_string(signup.usd_cents);
      auto id     = signupId(signup.id);
      auto body   = formEncode({{"mode", "payment"},
                                {"ui_mode", "embedded_page"},
                                {"redirect_on_completion", "never"},
                                {"allowed_payment_method_types[0]", "card"},
                                {"line_items[0][quantity]", "1"},
                                {"line_items[0][price_data][currency]", "usd"},
                                {"line_items[0][price_data][unit_amount]", amount},
                                {"line_items[0][price_data][product_data][name]", tier.label},
                                {"metadata[signup_id]", id}});
      // x-http does not add Content-Length to outgoing requests
      return HttpRequest{.method      = "POST",
                         .target      = "/v1/checkout/sessions",
                         .contentType = "application/x-www-form-urlencoded",
                         .headers     = {{"Authorization", "Bearer " + *keys.secret_key},
                                         {"Content-Length", std::to_string(body.size())}},
                         .body        = std::vector<char>(body.begin(), body.end())};
   }

   // Asks Stripe for the pending `signup`'s Checkout Session. `client` gets
   // the reply from `onStripeSession` or `onStripeError`.
   void startCheckout(const StripeKeys& keys,
                      const PaidTier&   tier,
                      const Signup&     signup,
                      std::int32_t      client)
   {
      auto socket = sendToApi(keys.api_base, checkoutSessionRequest(keys, tier, signup));
      PSIBASE_SUBJECTIVE_TX
      {
         to<XHttp>().setCallback(socket, MethodNumber{"onStripeSession"},
                                 MethodNumber{"onStripeError"});
         XPortal{}.open<PendingStripeRequestTable>().put(
             PendingStripeRequest{.socket          = socket,
                                  .client          = client,
                                  .signup          = signup.id,
                                  .publishable_key = *keys.publishable_key});
         to<XHttp>().autoClose(client, false);
      }
   }

   // A paid signup waits `pending` for its payment; a free one is queued for
   // provisioning. Returns nullopt when `xId` already has a free signup.
   std::optional<Signup> storeSignup(const SignupBody& body,
                                     const std::string& xId,
                                     const TierOffer&   offer)
   {
      bool                  paid = body.tier.has_value();
      std::optional<Signup> stored;
      PSIBASE_SUBJECTIVE_TX
      {
         stored.reset();
         auto table = XPortal{}.open<SignupTable>();
         bool taken = false;
         if (!paid)
         {
            for (auto row : table.getIndex<0>())
            {
               if (row.x_id && *row.x_id == xId && !row.tier && row.state != stateFailed)
               {
                  taken = true;
                  break;
               }
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
                              .usd_cents = offer.usd_cents,
                              .tokens    = offer.tokens,
                              .state     = std::string{paid ? statePending : stateQueued},
                              .created   = now,
                              .updated   = now,
                              .x_id      = xId,
                              .tier      = body.tier};
            table.put(*stored);
            if (!paid)
               to<XTimer>().runAt(monotonicNow(), MethodNumber{"provision"});
         }
      }
      return stored;
   }

   std::optional<HttpReply> serveSignup(const HttpRequest& req, std::optional<std::int32_t> socket)
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
      if (!config.requests_enabled || !status.ready)
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
      const PaidTier* paid = nullptr;
      if (body.tier)
      {
         paid = offeredPaidTier(config, status.billing_enabled);
         if (*body.tier != 0 || !paid)
            return textError(req, HttpStatus::badRequest, "tier is not offered\n");
      }
      else if (!config.free_tier.enabled)
         return textError(req, HttpStatus::forbidden, "account requests are not open\n");
      if (!psio::fracpack_validate_strict<InvPayload>(
              {reinterpret_cast<const char*>(body.payload->data()), body.payload->size()}))
         return textError(req, HttpStatus::badRequest, "payload is not an invite payload\n");
      if (to<Invite>().getInvite(*body.invite_id))
         return textError(req, HttpStatus::conflict, "invite id is taken\n");

      auto offer  = paid ? paidOffer(config, *paid) : freeOffer(config, status.billing_enabled);
      auto stored = storeSignup(body, session->x_id, offer);
      if (!stored)
         return textError(req, HttpStatus::conflict, "free signup already exists\n");
      if (!paid)
         return jsonBody(req, SignupReceipt{.signup_id = signupId(stored->id)});
      startCheckout(activeStripe(config), *paid, *stored, *socket);
      return std::nullopt;
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

   HttpReply serveRetrySignup(const HttpRequest& req,
                             std::optional<std::int32_t> socket,
                             std::string_view idText)
   {
      if (req.method == "OPTIONS")
         return HttpReply{.headers = cors(req)};
      if (auto reply = to<XAdmin>().checkAuth(req, socket))
         return *reply;
      if (req.method != "POST")
         return HttpReply::methodNotAllowed(req);
      auto id = parseSignupId(idText);
      if (!id)
         return textError(req, HttpStatus::badRequest, "invalid signup id\n");

      PSIBASE_SUBJECTIVE_TX
      {
         auto signup = XPortal{}.open<SignupTable>().get(*id);
         if (!signup)
            return textError(req, HttpStatus::notFound, "signup not found\n");
         if (signup->state != stateQueued)
            return textError(req, HttpStatus::conflict, "signup is not queued\n");
         auto attempts = XPortal{}.open<ProvisionAttemptTable>();
         if (attempts.get(*id))
            return textError(req, HttpStatus::conflict,
                             "signup already scheduled or attempted in this node session\n");
         for (const auto& push : XPortal{}.open<PendingPushTable>().getIndex<0>())
            if (push.signup == *id)
               return textError(req, HttpStatus::conflict, "signup push is still pending\n");
         if (to<Invite>().getInvite(signup->invite_id))
            return textError(req, HttpStatus::conflict, "signup invite already exists\n");
         attempts.put(ProvisionAttempt{.signup = *id, .retry_requested = true});
         to<XTimer>().runAt(monotonicNow(), MethodNumber{"provision"});
      }
      return jsonBody(req, SignupReceipt{.signup_id = signupId(*id)});
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

   HttpReply serveXStart(const HttpRequest& req, std::optional<std::int32_t> socket)
   {
      if (req.method != "GET")
         return HttpReply::methodNotAllowed(req);
      auto x = readConfig().x;
      if (!xConfigured(x))
         return textError(req, HttpStatus::serviceUnavailable,
                          "Sign in with X is not configured\n");

      bool         tls = socket && to<XHttp>().isSecure(*socket);
      auto         now = wallNow();
      XAuthRequest started{.state         = randomToken(),
                           .code_verifier = randomToken(),
                           .redirect_uri  = xCallbackUrl(req, tls),
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

   void sendXRequest(const XConfig&  x,
                     HttpRequest     request,
                     MethodNumber    callback,
                     PendingXRequest pending)
   {
      pending.socket = sendToApi(x.api_base, std::move(request));
      PSIBASE_SUBJECTIVE_TX
      {
         to<XHttp>().setCallback(pending.socket, callback, MethodNumber{"onXError"});
         XPortal{}.open<PendingXRequestTable>().put(pending);
      }
   }

   // Removes and returns the outbound request x-http is calling back on `socket`.
   template <typename Table>
   typename Table::value_type takePendingRequest(std::int32_t socket)
   {
      std::optional<typename Table::value_type> pending;
      PSIBASE_SUBJECTIVE_TX
      {
         auto table = XPortal{}.open<Table>();
         pending    = table.get(socket);
         check(pending.has_value(), "no pending request on socket " + std::to_string(socket));
         table.remove(*pending);
      }
      return *pending;
   }

   void replyToBrowser(std::int32_t client, const HttpReply& reply)
   {
      PSIBASE_SUBJECTIVE_TX
      {
         to<XHttp>().autoClose(client, true);
         to<XHttp>().sendReply(client, reply);
      }
   }

   HttpReply badGateway(std::string_view message)
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

      bool tls = socket && to<XHttp>().isSecure(*socket);
      sendXRequest(x, xTokenRequest(x, query.code, *started), MethodNumber{"onXToken"},
                   PendingXRequest{.client = *socket,
                                   .secure = publicHttps(req, tls)});
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
   T parseJsonReply(const HttpReply& reply)
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
          pending.client,
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

   HttpReply serveLogout(const HttpRequest& req, std::optional<std::int32_t> socket)
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
      bool         tls = socket && to<XHttp>().isSecure(*socket);
      auto           headers = cors(req);
      headers.push_back(sessionCookieHeader("", std::chrono::seconds{0}, publicHttps(req, tls)));
      return HttpReply{.headers = std::move(headers)};
   }

   struct StripeSessionReply
   {
      std::string                id;
      std::optional<std::string> client_secret;
      PSIO_REFLECT(StripeSessionReply, id, client_secret)
   };

   void updatePendingSignup(const Checksum256& id, auto&& update)
   {
      PSIBASE_SUBJECTIVE_TX
      {
         auto table = XPortal{}.open<SignupTable>();
         auto row   = table.get(id);
         check(row.has_value() && row->state == statePending, "signup is not pending");
         update(*row);
         row->updated = wallNow();
         table.put(*row);
      }
   }

   void failCheckout(const PendingStripeRequest& pending, const std::string& error)
   {
      updatePendingSignup(pending.signup,
                          [&](Signup& signup)
                          {
                             signup.state      = std::string{stateFailed};
                             signup.last_error = error;
                          });
      replyToBrowser(pending.client, badGateway("Stripe did not create a checkout session\n"));
   }

   bool sameBytes(std::span<const char> a, const Checksum256& b)
   {
      if (a.size() != b.size())
         return false;
      unsigned char diff = 0;
      for (std::size_t i = 0; i < b.size(); ++i)
         diff |= static_cast<unsigned char>(a[i]) ^ b[i];
      return diff == 0;
   }

   // `Stripe-Signature` is `t=<unix seconds>,v1=<hex>,...`. Any `v1` may match;
   // other schemes are ignored.
   bool verifyStripeSignature(const HttpRequest& req, std::string_view secret)
   {
      auto header = req.getHeader("stripe-signature");
      if (!header)
         return false;
      std::string_view              timestamp;
      std::vector<std::string_view> signatures;
      for (auto part : *header | std::views::split(','))
      {
         std::string_view item{part.begin(), part.end()};
         auto             eq = item.find('=');
         if (eq == std::string_view::npos)
            continue;
         if (item.substr(0, eq) == "t")
            timestamp = item.substr(eq + 1);
         else if (item.substr(0, eq) == "v1")
            signatures.push_back(item.substr(eq + 1));
      }

      std::int64_t sent = 0;
      auto [end, ec]    = std::from_chars(timestamp.data(), timestamp.data() + timestamp.size(), sent);
      if (timestamp.empty() || ec != std::errc{} || end != timestamp.data() + timestamp.size())
         return false;
      auto now =
          std::chrono::duration_cast<std::chrono::seconds>(wallNow().time_since_epoch()).count();
      auto tolerance = std::chrono::seconds{webhookTolerance}.count();
      if (sent < now - tolerance || sent > now + tolerance)
         return false;

      std::string signedPayload{timestamp};
      signedPayload += '.';
      signedPayload.append(req.body.begin(), req.body.end());
      auto expected = hmacSha256(secret, signedPayload);
      for (auto signature : signatures)
      {
         std::vector<char> bytes;
         if (signature.size() == 2 * expected.size() && psio::from_hex(signature, bytes) &&
             sameBytes(bytes, expected))
            return true;
      }
      return false;
   }

   struct StripeEventType
   {
      std::string type;
      PSIO_REFLECT(StripeEventType, type)
   };

   struct CheckoutMetadata
   {
      std::optional<std::string> signup_id;
      PSIO_REFLECT(CheckoutMetadata, signup_id)
   };

   struct CheckoutSession
   {
      std::string      payment_status;
      CheckoutMetadata metadata;
      PSIO_REFLECT(CheckoutSession, payment_status, metadata)
   };

   struct CheckoutEventData
   {
      CheckoutSession object;
      PSIO_REFLECT(CheckoutEventData, object)
   };

   struct CheckoutEvent
   {
      std::string       id;
      CheckoutEventData data;
      PSIO_REFLECT(CheckoutEvent, id, data)
   };

   // A verified event that names no known signup is ignored rather than
   // rejected, so Stripe does not keep retrying it.
   void applyCheckoutEvent(const CheckoutEvent& event)
   {
      const auto& session = event.data.object;
      if (!session.metadata.signup_id)
         return;
      auto id = parseSignupId(*session.metadata.signup_id);
      if (!id)
         return;
      PSIBASE_SUBJECTIVE_TX
      {
         auto table = XPortal{}.open<SignupTable>();
         if (auto row = table.get(*id))
         {
            if (!std::ranges::contains(row->stripe_event_ids, event.id))
               row->stripe_event_ids.push_back(event.id);
            if (session.payment_status == "paid" && row->state == statePending)
            {
               row->state = std::string{stateQueued};
               to<XTimer>().runAt(monotonicNow(), MethodNumber{"provision"});
            }
            row->updated = wallNow();
            table.put(*row);
         }
      }
   }

   HttpReply serveStripeWebhook(const HttpRequest& req)
   {
      if (req.method != "POST")
         return HttpReply::methodNotAllowed(req);
      auto        config = readConfig();
      const auto& keys   = activeStripe(config);
      if (!keys.webhook_secret || !verifyStripeSignature(req, *keys.webhook_secret))
         return textError(std::vector<HttpHeader>{}, HttpStatus::badRequest,
                          "invalid Stripe signature\n");
      // Only checkout events are parsed as sessions: other event objects may
      // type these fields differently, and an abort makes Stripe retry.
      auto text = std::string(req.body.begin(), req.body.end());
      auto type = psio::convert_from_json<StripeEventType>(text).type;
      if (type == "checkout.session.completed" || type == "checkout.session.async_payment_succeeded")
         applyCheckoutEvent(psio::convert_from_json<CheckoutEvent>(text));
      return HttpReply{};
   }

   // An admin can explicitly requeue an interrupted attempt after restart.
   // Otherwise committing an attempt prevents an abort from causing a retry loop.
   std::vector<Checksum256> dueSignupIds()
   {
      std::vector<Checksum256> ids;
      PSIBASE_SUBJECTIVE_TX
      {
         ids.clear();
         for (auto row : XPortal{}.open<SignupTable>().getIndex<0>())
         {
            auto attempt = XPortal{}.open<ProvisionAttemptTable>().get(row.id);
            if (row.state == stateQueued &&
                (row.attempts == 0 || (attempt && attempt->retry_requested)))
               ids.push_back(row.id);
         }
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
         auto attempts = XPortal{}.open<ProvisionAttemptTable>();
         auto attempt = attempts.get(id);
         if (auto row = table.get(id); row && row->state == stateQueued &&
             (row->attempts == 0 || (attempt && attempt->retry_requested)))
         {
            attempts.put(ProvisionAttempt{.signup = id});
            row->attempts += 1;
            row->last_error = std::string{signingAborted};
            row->updated    = wallNow();
            table.put(*row);
            claimed = *row;
         }
      }
      // Without an explicit retry, a later timer is not another attempt.
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
   if (target == "/tiers")
      return serveTiers(request);
   if (target == "/admin/config")
      return serveAdminConfig(request, socket);
   if (target == "/admin/agents/creator/keygen")
      return serveCreatorKeygen(request, socket);
   if (target == "/admin/signups")
      return serveFailedSignups(request, socket);
   if (target.starts_with("/admin/signups/") && target.ends_with("/retry"))
      return serveRetrySignup(request, socket,
                              std::string_view{target}.substr(15, target.size() - 15 - 6));
   if (target == "/signup")
      return serveSignup(request, socket);
   if (target == "/stripe/webhook")
      return serveStripeWebhook(request);
   if (target.starts_with("/signup/"))
      return serveSignupStatus(request, std::string_view{target}.substr(8));
   if (target == "/auth/x/start")
      return serveXStart(request, socket);
   if (target == "/auth/x/callback")
      return serveXCallback(request, socket);
   if (target == "/auth/logout")
      return serveLogout(request, socket);
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
   auto pending = takePendingRequest<PendingXRequestTable>(socket);
   if (reply.status != HttpStatus::ok)
      return replyToBrowser(pending.client, badGateway("X rejected the sign-in code\n"));
   auto token = parseJsonReply<XTokenReply>(reply).access_token;
   if (!token)
      return replyToBrowser(pending.client, badGateway("X sent no access token\n"));
   sendXRequest(readConfig().x, xUserRequest(*token), MethodNumber{"onXUser"}, pending);
}

void XPortal::onXUser(std::int32_t socket, HttpReply reply)
{
   check(getSender() == XHttp::service, "Wrong sender");
   auto                     pending = takePendingRequest<PendingXRequestTable>(socket);
   std::optional<XUserData> user;
   if (reply.status == HttpStatus::ok)
      user = parseJsonReply<XUserReply>(reply).data;
   if (!user || user->id.empty() || user->username.empty())
      return replyToBrowser(pending.client, badGateway("X did not return the signed-in user\n"));
   finishSignIn(pending, *user);
}

void XPortal::onXError(std::int32_t socket)
{
   check(getSender() == XHttp::service, "Wrong sender");
   replyToBrowser(takePendingRequest<PendingXRequestTable>(socket).client,
                  badGateway("X did not respond\n"));
}

void XPortal::onStripeSession(std::int32_t socket, HttpReply reply)
{
   check(getSender() == XHttp::service, "Wrong sender");
   auto pending = takePendingRequest<PendingStripeRequestTable>(socket);
   std::optional<StripeSessionReply> session;
   if (reply.status == HttpStatus::ok)
      session = parseJsonReply<StripeSessionReply>(reply);
   if (!session || session->id.empty() || !session->client_secret)
      return failCheckout(pending, std::string(reply.body.begin(), reply.body.end()));
   updatePendingSignup(pending.signup,
                       [&](Signup& signup) { signup.stripe_session_id = session->id; });
   replyToBrowser(pending.client,
                  jsonBody(std::vector<HttpHeader>{},
                           CheckoutReceipt{.signup_id       = signupId(pending.signup),
                                           .client_secret   = *session->client_secret,
                                           .publishable_key = pending.publishable_key}));
}

void XPortal::onStripeError(std::int32_t socket)
{
   check(getSender() == XHttp::service, "Wrong sender");
   failCheckout(takePendingRequest<PendingStripeRequestTable>(socket), "Stripe did not respond");
}

PSIBASE_DISPATCH(XPortal)
