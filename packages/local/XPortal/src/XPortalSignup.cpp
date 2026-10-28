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
   bool anotherFreeSignup(SignupTable&               table,
                          std::string_view           xId,
                          std::optional<Checksum256> except)
   {
      for (auto row : table.getIndex<0>())
      {
         if (except && row.id == *except)
            continue;
         if (row.x_id && *row.x_id == xId && !row.tier && row.state != stateFailed)
            return true;
      }
      return false;
   }

   // The retry after attempts 1..5. Attempt 6 is the last push.
   std::optional<MicroSeconds> nextProvisionDelay(uint32_t attempt)
   {
      static constexpr std::array<MicroSeconds, 5> delays{
          std::chrono::seconds{30}, std::chrono::minutes{2}, std::chrono::minutes{10},
          std::chrono::minutes{30}, std::chrono::hours{2},
      };
      if (attempt == 0 || attempt > delays.size())
         return std::nullopt;
      return delays[attempt - 1];
   }

   bool pushInFlight(const Checksum256& id)
   {
      for (const auto& push : XPortal{}.open<PendingPushTable>().getIndex<0>())
         if (push.signup == id)
            return true;
      return false;
   }

   // Due on the first attempt, an administrator retry, or once `retry_at` has
   // arrived. A future `retry_at` keeps an aborted signing from looping here.
   bool signupDue(const Signup& row)
   {
      if (row.state != stateQueued || pushInFlight(row.id))
         return false;
      if (row.attempts == 0)
         return true;
      auto attempt = XPortal{}.open<ProvisionAttemptTable>().get(row.id);
      return attempt && (attempt->retry_requested ||
                         (attempt->retry_at && *attempt->retry_at <= monotonicNow()));
   }

   // A paid signup waits `pending` for its payment; a free one is queued for
   // provisioning. Returns nullopt when `xId` already has a free signup.
   std::optional<Signup> storeSignup(const SignupBody&  body,
                                     const std::string& xId,
                                     const TierOffer&   offer,
                                     std::string_view   mode)
   {
      bool                  paid = body.tier.has_value();
      std::optional<Signup> stored;
      PSIBASE_SUBJECTIVE_TX
      {
         stored.reset();
         auto table = XPortal{}.open<SignupTable>();
         bool taken = !paid && anotherFreeSignup(table, xId, std::nullopt);
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
                              .tier      = body.tier,
                              .mode      = std::string{mode}};
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
      auto body =
          psio::convert_from_json<SignupBody>(std::string(req.body.begin(), req.body.end()));
      if (!body.invite_id)
         return textError(req, HttpStatus::badRequest, "invite_id is required\n");
      if (!body.payload)
         return textError(req, HttpStatus::badRequest, "payload is required\n");
      if (!body.token)
         return textError(req, HttpStatus::badRequest, "token is required\n");
      const PaidTier* paid = nullptr;
      if (body.tier)
      {
         if (!status.billing_enabled || *body.tier >= config.tiers.size())
            return textError(req, HttpStatus::badRequest, "tier is not offered\n");
         paid = &config.tiers[*body.tier];
      }
      else if (!config.free_tier.enabled)
         return textError(req, HttpStatus::forbidden, "account requests are not open\n");
      if (!psio::fracpack_validate_strict<InvPayload>(
              {reinterpret_cast<const char*>(body.payload->data()), body.payload->size()}))
         return textError(req, HttpStatus::badRequest, "payload is not an invite payload\n");
      if (to<Invite>().getInvite(*body.invite_id))
         return textError(req, HttpStatus::conflict, "invite id is taken\n");

      auto offer  = paid ? paidOffer(config, *paid) : freeOffer(config, status.billing_enabled);
      auto stored = storeSignup(body, session->x_id, offer, config.mode);
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
      return signupViewForSession(req, idText);
   }

   HttpReply serveRetrySignup(const HttpRequest&          req,
                              std::optional<std::int32_t> socket,
                              std::string_view            idText)
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
         auto table  = XPortal{}.open<SignupTable>();
         auto signup = table.get(*id);
         if (!signup)
            return textError(req, HttpStatus::notFound, "signup not found\n");
         if (signup->state != stateQueued && signup->state != stateFailed)
            return textError(req, HttpStatus::conflict, "signup is not queued\n");
         auto attempts = XPortal{}.open<ProvisionAttemptTable>();
         if (attempts.get(*id))
            return textError(req, HttpStatus::conflict,
                             "signup already scheduled or attempted in this node session\n");
         if (pushInFlight(*id))
            return textError(req, HttpStatus::conflict, "signup push is still pending\n");
         if (to<Invite>().getInvite(signup->invite_id))
            return textError(req, HttpStatus::conflict, "signup invite already exists\n");
         if (signup->state == stateFailed)
         {
            if (!signup->tier && signup->x_id &&
                anotherFreeSignup(table, *signup->x_id, signup->id))
               return textError(req, HttpStatus::conflict, "free signup already exists\n");
            signup->state      = std::string{stateQueued};
            signup->attempts   = 0;
            signup->last_error = {};
            signup->updated    = wallNow();
            table.put(*signup);
         }
         else
         {
            attempts.put(ProvisionAttempt{.signup = *id, .retry_requested = true});
         }
         to<XTimer>().runAt(monotonicNow(), MethodNumber{"provision"});
      }
      return jsonBody(req, SignupReceipt{.signup_id = signupId(*id)});
   }

   std::string randomToken()
   {
      Checksum256 id{};
      raw::getRandom(id.data(), id.size());
      return signupId(id);
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
                   PendingXRequest{.client = *socket, .secure = publicHttps(req, tls)});
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
      bool tls     = socket && to<XHttp>().isSecure(*socket);
      auto headers = cors(req);
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
      auto [end, ec] = std::from_chars(timestamp.data(), timestamp.data() + timestamp.size(), sent);
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

   struct StripeModeMatch
   {
      bool sandbox    = false;
      bool production = false;
   };

   StripeModeMatch verifiedStripeModes(const HttpRequest& req, const StripeConfig& stripe)
   {
      StripeModeMatch match;
      if (stripe.sandbox.webhook_secret)
         match.sandbox = verifyStripeSignature(req, *stripe.sandbox.webhook_secret);
      if (stripe.production.webhook_secret)
         match.production = verifyStripeSignature(req, *stripe.production.webhook_secret);
      return match;
   }

   bool modeSigned(const StripeModeMatch& match, std::string_view mode)
   {
      if (mode == modeSandbox)
         return match.sandbox;
      if (mode == modeProduction)
         return match.production;
      return false;
   }

   // A verified event that names no known signup, or a signup of a mode whose
   // secret did not match, is ignored rather than rejected, so Stripe does not
   // keep retrying it.
   void applyCheckoutEvent(const CheckoutEvent& event, const StripeModeMatch& match)
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
         auto row   = table.get(*id);
         if (row && modeSigned(match, row->mode) &&
             !std::ranges::contains(row->stripe_event_ids, event.id))
         {
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
      auto match = verifiedStripeModes(req, readConfig().stripe);
      if (!match.sandbox && !match.production)
         return textError(std::vector<HttpHeader>{}, HttpStatus::badRequest,
                          "invalid Stripe signature\n");
      // Only checkout events are parsed as sessions: other event objects may
      // type these fields differently, and an abort makes Stripe retry.
      auto text = std::string(req.body.begin(), req.body.end());
      auto type = psio::convert_from_json<StripeEventType>(text).type;
      if (type == "checkout.session.completed" ||
          type == "checkout.session.async_payment_succeeded")
         applyCheckoutEvent(psio::convert_from_json<CheckoutEvent>(text), match);
      return HttpReply{};
   }

   std::vector<Checksum256> dueSignupIds()
   {
      std::vector<Checksum256> ids;
      PSIBASE_SUBJECTIVE_TX
      {
         ids.clear();
         for (auto row : XPortal{}.open<SignupTable>().getIndex<0>())
            if (signupDue(row))
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
      actions.push_back(
          invite.createInvite(signup.invite_id, signup.payload, 1, false, cost, subsidy));
      return actions;
   }

   void provisionSignup(const Checksum256& id)
   {
      std::optional<Signup> claimed;
      PSIBASE_SUBJECTIVE_TX
      {
         claimed.reset();
         auto table = XPortal{}.open<SignupTable>();
         auto row   = table.get(id);
         if (row && signupDue(*row))
         {
            std::optional<MonotonicTimePointUSec> when;
            if (auto delay = nextProvisionDelay(row->attempts + 1))
               when = monotonicNow() + *delay;
            // Committed before `push` so an aborted `signTx` leaves this retry.
            XPortal{}.open<ProvisionAttemptTable>().put(
                ProvisionAttempt{.signup = id, .retry_at = when});
            row->attempts += 1;
            row->last_error = std::string{signingAborted};
            row->updated    = wallNow();
            table.put(*row);
            if (when)
               to<XTimer>().runAt(*when, MethodNumber{"provision"});
            claimed = *row;
         }
      }
      if (!claimed)
         return;
      pushAgentTx(signupActions(*claimed), claimed->id);
   }

   void applySignupResult(const Checksum256& id, const std::string* error)
   {
      auto table = XPortal{}.open<SignupTable>();
      auto row   = table.get(id);
      check(row.has_value() && row->state == stateQueued, "signup is not queued");
      auto attempts = XPortal{}.open<ProvisionAttemptTable>();
      auto attempt  = attempts.get(id);
      if (!error)
      {
         row->state      = std::string{stateInvited};
         row->last_error = {};
         attempts.erase(id);
      }
      else if (attempt && attempt->retry_at)
      {
         row->last_error = *error;
         // The timer scheduled with this attempt may already have fired.
         if (*attempt->retry_at <= monotonicNow())
            to<XTimer>().runAt(monotonicNow(), MethodNumber{"provision"});
      }
      else
      {
         row->state      = std::string{stateFailed};
         row->last_error = *error;
         attempts.erase(id);
      }
      row->updated = wallNow();
      table.put(*row);
   }
}  // namespace xportal

using namespace xportal;

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
