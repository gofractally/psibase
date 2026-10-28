#include <services/local/XPortal.hpp>

#include "XPortalDetail.hpp"

#include <algorithm>
#include <array>
#include <charconv>
#include <chrono>
#include <format>
#include <limits>
#include <psibase/HttpHeaders.hpp>
#include <psibase/base64.hpp>
#include <psibase/dispatch.hpp>
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

namespace xportal
{

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

   // $2.50 per standard buffer, stored as USD micros per whole token. An
   // unset free tier amount becomes $2.50. When the price is first seeded and
   // no paid tiers are set, they become Small $5, Medium $12.50, and Large $25.
   PortalConfig ensurePriced(PortalConfig config)
   {
      if (!to<VirtualServer>().is_billing_enabled() ||
          (config.price_per_token_usd_micros && config.free_tier.usd_cents))
         return config;

      if (!config.price_per_token_usd_micros)
      {
         auto token = to<Tokens>().getSysToken();
         check(token.has_value(), "system token is not set");
         auto scale = unitScale(token->precision.value);
         auto cost  = to<VirtualServer>().std_buffer_cost().value;
         check(cost != 0, "standard buffer cost is zero");
         check(seedUsdMicros <= std::numeric_limits<uint64_t>::max() / scale,
               "seed price overflow");
         auto price = (seedUsdMicros * scale) / cost;
         check(price != 0, "seeded token price is zero for buffer cost " + std::to_string(cost));
         config.price_per_token_usd_micros = price;
         if (config.tiers.empty())
            config.tiers = {{.label = "Small", .usd_cents = smallTierUsdCents},
                            {.label = "Medium", .usd_cents = mediumTierUsdCents},
                            {.label = "Large", .usd_cents = largeTierUsdCents}};
      }
      if (!config.free_tier.usd_cents)
         config.free_tier.usd_cents = freeTierUsdCents;
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

   // Whole standard buffers contained in `tokens`.
   uint64_t bufferMultiple(Quantity tokens)
   {
      auto cost = to<VirtualServer>().std_buffer_cost().value;
      check(cost != 0, "standard buffer cost is zero");
      return tokens.value / cost;
   }

   // While billing is disabled, a free signup is charged and granted nothing.
   TierOffer freeOffer(const PortalConfig& config, bool billing)
   {
      if (!billing)
         return {};
      check(config.free_tier.usd_cents.has_value(), "free tier amount is not set");
      auto usd    = *config.free_tier.usd_cents;
      auto tokens = tokensAtPrice(config, usd);
      return {.usd_cents = usd, .tokens = tokens, .buffer_multiple = bufferMultiple(tokens)};
   }

   TierOffer paidOffer(const PortalConfig& config, const PaidTier& tier)
   {
      auto tokens = tokensAtPrice(config, tier.usd_cents);
      return {
          .usd_cents = tier.usd_cents, .tokens = tokens, .buffer_multiple = bufferMultiple(tokens)};
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

   Quantity largestGrant(const PortalConfig& config)
   {
      std::vector<Quantity> grants;
      if (config.free_tier.enabled)
      {
         auto free = freeTierTokens(config);
         check(free.has_value(), "free tier grant is not set");
         grants.push_back(*free);
      }
      for (const auto& tier : config.tiers)
         grants.push_back(tokensAtPrice(config, tier.usd_cents));
      check(!grants.empty(), "no tier grant is set");
      return *std::ranges::max_element(grants, {}, &Quantity::value);
   }

   bool creatorTokens(const PortalConfig& config)
   {
      auto sys = to<Tokens>().getSysToken();
      check(sys.has_value(), "system token is not set");
      auto cost    = to<Invite>().getInvCost(1, largestGrant(config));
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

   // Provisioning push listener selection: struct XPortal doc comment.
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

   const StripeKeys& activeStripe(const PortalConfig& config)
   {
      if (config.mode == modeProduction)
         return config.stripe.production;
      check(config.mode == modeSandbox, "unknown Stripe mode " + config.mode);
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

   std::optional<PricingBasis> pricingBasis()
   {
      if (!to<VirtualServer>().is_billing_enabled())
         return std::nullopt;
      auto token = to<Tokens>().getSysToken();
      check(token.has_value(), "system token is not set");
      return PricingBasis{
          .precision       = token->precision.value,
          .supply          = Quantity{token->issued_supply.value - token->burned_supply.value},
          .std_buffer_cost = to<VirtualServer>().std_buffer_cost()};
   }

   AdminConfig adminView(const HttpRequest& req, const PortalConfig& config, bool tls)
   {
      auto key = readCreatorAgentKey();
      return AdminConfig{
          .requests_enabled           = config.requests_enabled,
          .price_per_token_usd_micros = config.price_per_token_usd_micros,
          .free_tier                  = TierView{.enabled   = config.free_tier.enabled,
                                                 .usd_cents = config.free_tier.usd_cents,
                                                 .tokens    = freeTierTokens(config)},
          .pricing_basis              = pricingBasis(),
          .producer                   = configuredProducer(),
          .account                    = to<RTransact>().getUser(req),
          .creator_pubkey =
              key ? std::optional<AuthSig::SubjectPublicKeyInfo>{key->pubkey} : std::nullopt,
          .creator_allowed = XPortal::creatorAllowed(),
          .x               = maskedX(config.x),
          .x_callback_url  = xCallbackUrl(req, tls),
          .mode            = config.mode,
          .stripe          = maskedStripe(config.stripe),
          .tiers           = config.tiers};
   }

   Status portalStatus(const PortalConfig& config)
   {
      auto   billing     = to<VirtualServer>().is_billing_enabled();
      auto   paidOffered = billing && !config.tiers.empty();
      Status status{.requests_enabled = config.requests_enabled,
                    .billing_enabled  = billing,
                    .mode             = config.mode};
      status.conditions.push_back({.id = "creator_ready", .ok = creatorReady()});
      if (billing)
      {
         status.conditions.push_back({.id = "creator_tokens", .ok = creatorTokens(config)});
         status.conditions.push_back({.id = "creator_resources", .ok = creatorResources()});
      }
      status.conditions.push_back({.id = "x_configured", .ok = xConfigured(config.x)});
      status.conditions.push_back(
          {.id = "stripe_configured", .ok = stripeConfigured(activeStripe(config))});
      status.ready = std::ranges::all_of(status.conditions,
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
      if (billing)
      {
         for (uint32_t index = 0; index < config.tiers.size(); ++index)
         {
            const auto& tier  = config.tiers[index];
            auto        offer = paidOffer(config, tier);
            offers.tiers.push_back({.index           = index,
                                    .label           = tier.label,
                                    .usd_cents       = offer.usd_cents,
                                    .tokens          = offer.tokens,
                                    .buffer_multiple = offer.buffer_multiple});
         }
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

   // Returns the 400 message, naming the field `name`, when `value` is not a
   // positive integer.
   std::optional<std::string> readPositive(const psio::json::any& value,
                                           std::string_view       name,
                                           uint64_t&              out)
   {
      // JSON numbers arrive as their source text, the same as strings.
      uint64_t parsed = 0;
      if (auto text = value.get_if<std::string>())
      {
         auto end    = text->data() + text->size();
         auto result = std::from_chars(text->data(), end, parsed);
         if (result.ec == std::errc{} && result.ptr == end && parsed != 0)
         {
            out = parsed;
            return std::nullopt;
         }
      }
      return std::format("{} must be a positive integer\n", name);
   }

   std::optional<std::string> updateFreeTier(const psio::json::any& value, TierConfig& tier)
   {
      auto fields = value.get_if<psio::json::any_object>();
      if (!fields)
         return "free_tier must be an object\n";
      if (auto enabled = objectField(*fields, "enabled"))
      {
         auto flag = enabled->get_if<bool>();
         if (!flag)
            return "free_tier.enabled must be a boolean\n";
         tier.enabled = *flag;
      }
      if (auto cents = objectField(*fields, "usd_cents"))
      {
         uint64_t parsed = 0;
         if (auto error = readPositive(*cents, "free_tier.usd_cents", parsed))
            return error;
         tier.usd_cents = parsed;
      }
      return std::nullopt;
   }

   // A wrongly typed tier field aborts.
   std::optional<std::string> updateTiers(const psio::json::any& value,
                                          std::vector<PaidTier>& tiers)
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
   // when the body sets nothing, a field has the wrong type, or no tier is
   // left offered.
   std::optional<std::string> updateConfig(const HttpRequest& req, PortalConfig& config)
   {
      auto object = psio::convert_from_json<psio::json::any_object>(
          std::string(req.body.begin(), req.body.end()));
      auto requests = objectField(object, "requests_enabled");
      auto price    = objectField(object, "price_per_token_usd_micros");
      auto freeTier = objectField(object, "free_tier");
      auto x        = objectField(object, "x");
      auto mode     = objectField(object, "mode");
      auto stripe   = objectField(object, "stripe");
      auto tiers    = objectField(object, "tiers");
      if (!requests && !price && !freeTier && !x && !mode && !stripe && !tiers)
         return "requests_enabled, price_per_token_usd_micros, free_tier, x, mode, stripe, or "
                "tiers is required\n";
      if (requests)
      {
         auto flag = requests->get_if<bool>();
         if (!flag)
            return "requests_enabled must be a boolean\n";
         config.requests_enabled = *flag;
      }
      if (price)
      {
         uint64_t parsed = 0;
         if (auto error = readPositive(*price, "price_per_token_usd_micros", parsed))
            return error;
         config.price_per_token_usd_micros = parsed;
      }
      if (freeTier)
         if (auto error = updateFreeTier(*freeTier, config.free_tier))
            return error;
      if (x)
         if (auto error = updateX(*x, config.x))
            return error;
      if (mode)
      {
         auto text = mode->get_if<std::string>();
         if (!text || (*text != modeSandbox && *text != modeProduction))
            return "mode must be sandbox or production\n";
         config.mode = *text;
      }
      if (stripe)
         if (auto error = updateStripe(*stripe, config.stripe))
            return error;
      if (tiers)
         if (auto error = updateTiers(*tiers, config.tiers))
            return error;
      if (!config.free_tier.enabled && config.tiers.empty())
         return "the free tier or a paid tier must be offered\n";
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

      AgentKey created{.name = std::string{XPortal::creatorAgent}, .pubkey = to<XKeys>().newKey()};
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

}  // namespace xportal

using namespace xportal;

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

PSIBASE_DISPATCH(XPortal)
