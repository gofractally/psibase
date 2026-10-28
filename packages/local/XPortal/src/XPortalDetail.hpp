#pragma once

#include <services/local/XPortal.hpp>

#include <chrono>
#include <cstdint>
#include <initializer_list>
#include <optional>
#include <span>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include <psibase/Rpc.hpp>
#include <psio/json/any.hpp>
#include <psio/stream.hpp>
#include <psio/to_json.hpp>
#include <services/local/XAdmin.hpp>

using namespace psibase;
using namespace LocalService;
using namespace SystemService;
using namespace UserService;
using UserService::InviteNs::Invite;
using UserService::InviteNs::InvPayload;

namespace xportal
{
   // $2.50 as USD micros for a one-time token-price bootstrap when unset—not
   // a configured per-buffer charge.
   inline constexpr uint64_t seedUsdMicros      = 2'500'000;
   inline constexpr uint64_t freeTierUsdCents   = 250;
   inline constexpr uint64_t smallTierUsdCents  = 500;
   inline constexpr uint64_t mediumTierUsdCents = 1'250;
   inline constexpr uint64_t largeTierUsdCents  = 2'500;

   inline constexpr std::string_view statePending   = "pending";
   inline constexpr std::string_view stateQueued    = "queued";
   inline constexpr std::string_view stateInvited   = "invited";
   inline constexpr std::string_view stateRedeemed  = "redeemed";
   inline constexpr std::string_view stateFailed    = "failed";
   inline constexpr std::string_view modeSandbox    = "sandbox";
   inline constexpr std::string_view modeProduction = "production";
   inline constexpr std::string_view signingAborted = "signing aborted";
   inline constexpr char             signupMemo[]   = "x-portal signup";

   inline constexpr std::string_view xAuthorizeUrl  = "https://x.com/i/oauth2/authorize";
   inline constexpr std::string_view xScope         = "users.read tweet.read";
   inline constexpr std::string_view sessionCookie  = "XPORTAL_SESSION";
   inline constexpr auto             authRequestTtl = std::chrono::minutes{10};
   inline constexpr auto             sessionTtl     = std::chrono::days{7};

   inline constexpr auto webhookTolerance = std::chrono::minutes{5};

   inline std::vector<HttpHeader> cors(const HttpRequest& req)
   {
      return allowCors(req, {XPortal::service, XAdmin::service});
   }

   inline HttpReply jsonBody(std::vector<HttpHeader> headers, const auto& value)
   {
      HttpReply           reply{.contentType = "application/json", .headers = std::move(headers)};
      psio::vector_stream stream{reply.body};
      to_json(value, stream);
      return reply;
   }

   inline HttpReply jsonBody(const HttpRequest& req, const auto& value)
   {
      return jsonBody(cors(req), value);
   }

   inline HttpReply textError(std::vector<HttpHeader> headers, HttpStatus status, std::string_view message)
   {
      return HttpReply{.status      = status,
                       .contentType = "text/html",
                       .body        = std::vector<char>(message.begin(), message.end()),
                       .headers     = std::move(headers)};
   }

   inline HttpReply textError(const HttpRequest& req, HttpStatus status, std::string_view message)
   {
      return textError(cors(req), status, message);
   }


   PortalConfig readConfig();
   std::optional<AgentKey> readCreatorAgentKey();
   void writeCreatorAgentKey(const AgentKey& key);
   void writeConfig(const PortalConfig& config);
   uint64_t unitScale(uint8_t precision);
   PortalConfig ensurePriced(PortalConfig config);
   PortalConfig loadedConfig();
   Quantity tokensFor(uint64_t usdCents, uint64_t priceMicros, uint8_t precision);
   Quantity tokensAtPrice(const PortalConfig& config, uint64_t usdCents);
   std::optional<Quantity> freeTierTokens(const PortalConfig& config);
   uint64_t bufferMultiple(Quantity tokens);
   TierOffer freeOffer(const PortalConfig& config, bool billing);
   TierOffer paidOffer(const PortalConfig& config, const PaidTier& tier);
   bool creatorReady();
   Quantity resourceBuffer(AccountNumber account);
   Quantity largestGrant(const PortalConfig& config);
   bool creatorTokens(const PortalConfig& config);
   bool creatorResources();
   std::optional<AccountNumber> configuredProducer();
   SocketEndpoint nodeEndpoint();
   void pushAgentTx(std::vector<Action> actions, Checksum256 signup);
   std::optional<std::string> pushError(const HttpReply& reply);
   TimePointUSec wallNow();
   inline MonotonicTimePointUSec monotonicNow()
   {
      return std::chrono::time_point_cast<MicroSeconds>(std::chrono::steady_clock::now());
   }
   void applySignupResult(const Checksum256& id, const std::string* error);
   void finishPush(std::int32_t socket, std::optional<std::string> error);
   bool xConfigured(const XConfig& x);
   const StripeKeys& activeStripe(const PortalConfig& config);
   bool stripeConfigured(const StripeKeys& keys);
   void maskSecret(std::optional<std::string>& secret);
   XConfig maskedX(XConfig x);
   StripeConfig maskedStripe(StripeConfig stripe);
   std::string xCallbackUrl(const HttpRequest& req, bool tls);
   std::optional<PricingBasis> pricingBasis();
   AdminConfig adminView(const HttpRequest& req, const PortalConfig& config, bool tls);
   Status portalStatus(const PortalConfig& config);
   HttpReply serveStatus(const HttpRequest& req);
   HttpReply serveTiers(const HttpRequest& req);
   const psio::json::any* objectField(const psio::json::any_object& object, std::string_view key);
   std::optional<std::string> readStringField(const psio::json::any_object& object,
                                              std::string_view              path,
                                              std::string_view              key,
                                              std::optional<std::string>&   out);
   std::optional<std::string> readApiBase(const psio::json::any_object& object,
                                          std::string_view              path,
                                          std::string&                  apiBase);
   std::optional<std::string> updateX(const psio::json::any& value, XConfig& x);
   std::optional<std::string> updateStripeKeys(const psio::json::any& value,
                                               std::string_view       path,
                                               StripeKeys&            keys);
   std::optional<std::string> updateStripe(const psio::json::any& value, StripeConfig& stripe);
   std::optional<std::string> readPositive(const psio::json::any& value,
                                           std::string_view       name,
                                           uint64_t&              out);
   std::optional<std::string> updateFreeTier(const psio::json::any& value, TierConfig& tier);
   std::optional<std::string> updateTiers(const psio::json::any& value,
                                          std::vector<PaidTier>& tiers);
   std::optional<std::string> updateConfig(const HttpRequest& req, PortalConfig& config);
   HttpReply serveAdminConfig(const HttpRequest& req, std::optional<std::int32_t> socket);
   HttpReply serveCreatorKeygen(const HttpRequest& req, std::optional<std::int32_t> socket);
   HttpReply serveActivateCreator(const HttpRequest& req, std::optional<std::int32_t> socket);
   HttpReply serveAgents(const HttpRequest& req, std::optional<std::int32_t> socket);
   void reconcileInvitedSignups();
   SignupView signupView(const Signup& stored);
   HttpReply  signupViewForSession(const HttpRequest& req, std::string_view idText);
   HttpReply  serveRedeemed(const HttpRequest& req, std::string_view idText);
   std::optional<Checksum256> parseSignupId(std::string_view text);
   std::string signupId(const Checksum256& id);
   std::optional<XSession> currentSession(const HttpRequest& req);
   std::optional<XSession> requireSession(const HttpRequest& req, HttpReply& denied);
   std::string formEncode(
       std::initializer_list<std::pair<std::string_view, std::string_view>> fields);
   std::int32_t sendToApi(std::string_view apiBase, HttpRequest request);
   HttpRequest checkoutSessionRequest(const StripeKeys& keys,
                                      const PaidTier&   tier,
                                      const Signup&     signup);
   void startCheckout(const StripeKeys& keys,
                      const PaidTier&   tier,
                      const Signup&     signup,
                      std::int32_t      client);
   std::optional<Signup> storeSignup(const SignupBody&  body,
                                     const std::string& xId,
                                     const TierOffer&   offer,
                                     std::string_view   mode);
   std::optional<HttpReply> serveSignup(const HttpRequest& req, std::optional<std::int32_t> socket);
   HttpReply serveSignupStatus(const HttpRequest& req, std::string_view idText);
   HttpReply serveRetrySignup(const HttpRequest&          req,
                              std::optional<std::int32_t> socket,
                              std::string_view            idText);
   HttpReply serveAdminSignups(const HttpRequest& req, std::optional<std::int32_t> socket);
   std::string randomToken();
   std::string codeChallenge(std::string_view verifier);
   HttpReply redirect(std::string location, std::vector<HttpHeader> headers = {});
   HttpHeader sessionCookieHeader(std::string_view value, std::chrono::seconds maxAge, bool secure);
   HttpReply serveXStart(const HttpRequest& req, std::optional<std::int32_t> socket);
   HttpRequest xTokenRequest(const XConfig& x, std::string_view code, const XAuthRequest& started);
   HttpRequest xUserRequest(std::string_view accessToken);
   void sendXRequest(const XConfig&  x,
                     HttpRequest     request,
                     MethodNumber    callback,
                     PendingXRequest pending);
   void replyToBrowser(std::int32_t client, const HttpReply& reply);
   HttpReply badGateway(std::string_view message);
   std::optional<HttpReply> serveXCallback(const HttpRequest&          req,
                                           std::optional<std::int32_t> socket);
   HttpReply serveMe(const HttpRequest& req);
   HttpReply serveLogout(const HttpRequest& req, std::optional<std::int32_t> socket);
   void failCheckout(const PendingStripeRequest& pending, const std::string& error);
   bool sameBytes(std::span<const char> a, const Checksum256& b);
   bool verifyStripeSignature(const HttpRequest& req, std::string_view secret);
   HttpReply serveStripeWebhook(const HttpRequest& req);
   std::vector<Checksum256> dueSignupIds();
   std::vector<Action> signupActions(const Signup& signup);
   void provisionSignup(const Checksum256& id);
}  // namespace xportal
