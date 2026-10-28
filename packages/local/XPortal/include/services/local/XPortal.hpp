#pragma once

#include <optional>
#include <psibase/Rpc.hpp>
#include <psibase/Service.hpp>
#include <psibase/crypto.hpp>
#include <psibase/time.hpp>
#include <services/system/AuthScope.hpp>
#include <services/system/Spki.hpp>
#include <services/user/Invite.hpp>
#include <services/user/Tokens.hpp>
#include <services/user/tokenTypes.hpp>
#include <string>
#include <vector>

namespace LocalService
{
   struct TierConfig
   {
      bool                    enabled = true;
      std::optional<uint64_t> usd_cents;
      PSIO_REFLECT(TierConfig, enabled, usd_cents)
   };

   /// X OAuth 2.0 confidential-client credentials. Sign in with X is
   /// configured once `client_id` and `client_secret` are both set.
   struct XConfig
   {
      std::optional<std::string> client_id;
      std::optional<std::string> client_secret;
      std::string                api_base = "https://api.x.com";
      PSIO_REFLECT(XConfig, client_id, client_secret, api_base)
   };

   /// Stripe API keys for one mode. A mode is configured once `secret_key`,
   /// `publishable_key`, and `webhook_secret` are all set.
   struct StripeKeys
   {
      std::optional<std::string> secret_key;
      std::optional<std::string> publishable_key;
      std::optional<std::string> webhook_secret;
      std::string                api_base = "https://api.stripe.com";
      PSIO_REFLECT(StripeKeys, secret_key, publishable_key, webhook_secret, api_base)
   };

   struct StripeConfig
   {
      StripeKeys sandbox;
      StripeKeys production;
      PSIO_REFLECT(StripeConfig, sandbox, production)
   };

   /// A tier sold through Stripe for `usd_cents`.
   struct PaidTier
   {
      std::string label;
      uint64_t    usd_cents = 0;
      PSIO_REFLECT(PaidTier, label, usd_cents)
   };

   struct PortalConfig
   {
      bool                    requests_enabled = false;
      std::optional<uint64_t> price_per_token_usd_micros;
      TierConfig              free_tier;
      XConfig                 x;
      /// `sandbox` or `production`: which `stripe` keys are active.
      std::string           mode = "sandbox";
      StripeConfig          stripe;
      std::vector<PaidTier> tiers;
      PSIO_REFLECT(PortalConfig,
                   requests_enabled,
                   price_per_token_usd_micros,
                   free_tier,
                   x,
                   mode,
                   stripe,
                   tiers)
   };
   using PortalConfigTable = psibase::Table<PortalConfig, psibase::SingletonKey{}>;
   PSIO_REFLECT_TYPENAME(PortalConfigTable)

   struct AgentKey
   {
      std::string                                                 name;
      SystemService::AuthSig::SubjectPublicKeyInfo                pubkey;
      std::optional<SystemService::AuthSig::SubjectPublicKeyInfo> pending_pubkey;
      PSIO_REFLECT(AgentKey, name, pubkey, pending_pubkey)
   };
   using AgentKeyTable = psibase::Table<AgentKey, &AgentKey::name>;
   PSIO_REFLECT_TYPENAME(AgentKeyTable)

   /// A signup record. Ids are 32 bytes. `invite_id`, `payload`, and `token`
   /// come from the visitor's Invite plugin `prepare-new-invite`.
   /// `x_id` is the X user who requested the account. `tier` is unset for the
   /// free tier. A paid signup is `pending` until Stripe reports it paid;
   /// `stripe_session_id` is its Checkout Session and `stripe_event_ids` are
   /// the webhook events already applied. A repeated event id is ignored.
   struct Signup
   {
      psibase::Checksum256       id;
      uint32_t                   invite_id = 0;
      std::vector<uint8_t>       payload;
      std::string                token;
      uint64_t                   usd_cents = 0;
      UserService::Quantity      tokens;
      std::string                state;
      uint32_t                   attempts = 0;
      std::string                last_error;
      psibase::TimePointUSec     created;
      psibase::TimePointUSec     updated;
      std::optional<std::string> x_id;
      std::optional<uint32_t>    tier;
      std::optional<std::string> stripe_session_id;
      std::vector<std::string>   stripe_event_ids;
      PSIO_REFLECT(Signup,
                   id,
                   invite_id,
                   payload,
                   token,
                   usd_cents,
                   tokens,
                   state,
                   attempts,
                   last_error,
                   created,
                   updated,
                   x_id,
                   tier,
                   stripe_session_id,
                   stripe_event_ids)
   };
   using SignupTable = psibase::Table<Signup, &Signup::id>;
   PSIO_REFLECT_TYPENAME(SignupTable)

   /// An agent transaction sent to `transact` that has no final reply yet.
   /// `signup` is set when the push provisions a signup record.
   struct PendingPush
   {
      std::int32_t         socket;
      psibase::Checksum256 signup;
      PSIO_REFLECT(PendingPush, socket, signup)
   };
   using PendingPushTable = psibase::Table<PendingPush, &PendingPush::socket>;
   PSIO_REFLECT_TYPENAME(PendingPushTable)

   /// One provisioning attempt in this node session. `retry_at` is when the
   /// next automatic retry is due. `retry_requested` marks an administrator
   /// retry of an interrupted queued signup. The row remains until the push
   /// finishes or the session ends.
   struct ProvisionAttempt
   {
      psibase::Checksum256                           signup;
      bool                                           retry_requested = false;
      std::optional<psibase::MonotonicTimePointUSec> retry_at;
      PSIO_REFLECT(ProvisionAttempt, signup, retry_requested, retry_at)
   };
   using ProvisionAttemptTable = psibase::Table<ProvisionAttempt, &ProvisionAttempt::signup>;
   PSIO_REFLECT_TYPENAME(ProvisionAttemptTable)

   /// An X authorization that `GET /auth/x/start` began and
   /// `/auth/x/callback` has not consumed.
   struct XAuthRequest
   {
      std::string            state;
      std::string            code_verifier;
      std::string            redirect_uri;
      psibase::TimePointUSec expires;
      using ByExpiry = psibase::CompositeKey<&XAuthRequest::expires, &XAuthRequest::state>;
      PSIO_REFLECT(XAuthRequest, state, code_verifier, redirect_uri, expires)
   };
   using XAuthRequestTable =
       psibase::Table<XAuthRequest, &XAuthRequest::state, XAuthRequest::ByExpiry{}>;
   PSIO_REFLECT_TYPENAME(XAuthRequestTable)

   struct XUser
   {
      std::string x_id;
      std::string handle;
      PSIO_REFLECT(XUser, x_id, handle)
   };
   using XUserTable = psibase::Table<XUser, &XUser::x_id>;
   PSIO_REFLECT_TYPENAME(XUserTable)

   /// A signed-in browser. `session_id` is its `XPORTAL_SESSION` cookie.
   struct XSession
   {
      std::string            session_id;
      std::string            x_id;
      std::string            handle;
      psibase::TimePointUSec expires;
      PSIO_REFLECT(XSession, session_id, x_id, handle, expires)
   };
   using XSessionTable = psibase::Table<XSession, &XSession::session_id>;
   PSIO_REFLECT_TYPENAME(XSessionTable)

   /// An X API request made while completing a sign-in. `client` is the
   /// browser's `/auth/x/callback` socket, which gets the final reply.
   /// `secure` marks the session cookie `Secure`.
   struct PendingXRequest
   {
      std::int32_t socket;
      std::int32_t client;
      bool         secure = true;
      PSIO_REFLECT(PendingXRequest, socket, client, secure)
   };
   using PendingXRequestTable = psibase::Table<PendingXRequest, &PendingXRequest::socket>;
   PSIO_REFLECT_TYPENAME(PendingXRequestTable)

   /// A Checkout Session request to Stripe for `signup`. `client` is the
   /// browser's `POST /signup` socket, which gets the final reply.
   /// `publishable_key` pairs with the secret key the request used.
   struct PendingStripeRequest
   {
      std::int32_t         socket;
      std::int32_t         client;
      psibase::Checksum256 signup;
      std::string          publishable_key;
      PSIO_REFLECT(PendingStripeRequest, socket, client, signup, publishable_key)
   };
   using PendingStripeRequestTable =
       psibase::Table<PendingStripeRequest, &PendingStripeRequest::socket>;
   PSIO_REFLECT_TYPENAME(PendingStripeRequestTable)

   /// `GET /admin/config`. `tokens` is computed; it is not stored.
   struct TierView
   {
      bool                                 enabled = true;
      std::optional<uint64_t>              usd_cents;
      std::optional<UserService::Quantity> tokens;
      PSIO_REFLECT(TierView, enabled, usd_cents, tokens)
   };

   /// What tier grants are computed from. A tier's `tokens` is
   /// `usd_cents * 10^4 * 10^precision / price_per_token_usd_micros`, and the
   /// network market cap is that price times `supply`, the system token's
   /// issued minus burned supply.
   struct PricingBasis
   {
      uint8_t               precision = 0;
      UserService::Quantity supply;
      UserService::Quantity std_buffer_cost;
      PSIO_REFLECT(PricingBasis, precision, supply, std_buffer_cost)
   };

   struct AdminConfig
   {
      bool                    requests_enabled = false;
      std::optional<uint64_t> price_per_token_usd_micros;
      TierView                free_tier;
      /// Set while billing is enabled.
      std::optional<PricingBasis>           pricing_basis;
      std::optional<psibase::AccountNumber> producer;
      std::optional<psibase::AccountNumber> account;
      /// PEM public key once `POST /admin/agents/creator/keygen` has stored one.
      std::optional<SystemService::AuthSig::SubjectPublicKeyInfo> creator_pubkey;
      /// Canonical whitelist applied when `ac-creator` is created. Not the on-chain row.
      std::vector<SystemService::AllowedAction> creator_allowed;
      /// `client_secret` shows only its last four characters.
      XConfig x;
      /// OAuth redirect URI for this request; not stored.
      std::string x_callback_url;
      std::string mode;
      /// `secret_key` and `webhook_secret` show only their last four characters.
      StripeConfig          stripe;
      std::vector<PaidTier> tiers;
      PSIO_REFLECT(AdminConfig,
                   requests_enabled,
                   price_per_token_usd_micros,
                   free_tier,
                   pricing_basis,
                   producer,
                   account,
                   creator_pubkey,
                   creator_allowed,
                   x,
                   x_callback_url,
                   mode,
                   stripe,
                   tiers)
   };

   struct Condition
   {
      std::string id;
      bool        ok = false;
      PSIO_REFLECT(Condition, id, ok)
   };

   /// `GET /status`. Conditions carry an id and whether it holds, and nothing else.
   /// When billing is disabled, `creator_ready`, `x_configured`, and
   /// `stripe_configured` (the active mode's keys are set) are present.
   /// When billing is enabled, `creator_tokens` and `creator_resources` are added.
   /// `creator_tokens` holds when the creator account's balance covers
   /// `invite::getInvCost(1, tokens)` for the largest `tokens` among the
   /// enabled free tier and the paid tiers.
   /// `ready` requires every condition except `x_configured`, and requires
   /// `stripe_configured` only while paid tiers are offered.
   struct Status
   {
      bool                   requests_enabled = false;
      bool                   billing_enabled  = false;
      bool                   ready            = false;
      std::vector<Condition> conditions;
      PSIO_REFLECT(Status, requests_enabled, billing_enabled, ready, conditions)
   };

   /// `POST /signup` body. A missing `invite_id`, `payload`, or `token` is a
   /// 400, not a default. Omitting `tier` requests the free tier. A paid
   /// tier's index selects that tier; any other index is a 400.
   struct SignupBody
   {
      std::optional<uint32_t>             invite_id;
      std::optional<std::vector<uint8_t>> payload;
      std::optional<std::string>          token;
      std::optional<uint32_t>             tier;
      PSIO_REFLECT(SignupBody, invite_id, payload, token, tier)
   };

   /// `POST /signup` returns the new signup's id, base64url of its 32 bytes.
   struct SignupReceipt
   {
      std::string signup_id;
      PSIO_REFLECT(SignupReceipt, signup_id)
   };

   /// `POST /signup` for a paid tier. `client_secret` and `publishable_key`
   /// initialize Stripe Embedded Checkout.
   struct CheckoutReceipt
   {
      std::string signup_id;
      std::string client_secret;
      std::string publishable_key;
      PSIO_REFLECT(CheckoutReceipt, signup_id, client_secret, publishable_key)
   };

   /// What a signup for this tier is charged and granted. `buffer_multiple`
   /// counts whole standard buffers in `tokens`.
   struct TierOffer
   {
      uint64_t              usd_cents = 0;
      UserService::Quantity tokens;
      uint64_t              buffer_multiple = 0;
      PSIO_REFLECT(TierOffer, usd_cents, tokens, buffer_multiple)
   };

   struct PaidTierOffer
   {
      uint32_t              index = 0;
      std::string           label;
      uint64_t              usd_cents = 0;
      UserService::Quantity tokens;
      uint64_t              buffer_multiple = 0;
      PSIO_REFLECT(PaidTierOffer, index, label, usd_cents, tokens, buffer_multiple)
   };

   /// `GET /tiers`. `free` is unset when the free tier is disabled. `tiers`
   /// lists each paid tier while billing is enabled, and is otherwise empty.
   struct TierOffers
   {
      std::optional<TierOffer>   free;
      std::vector<PaidTierOffer> tiers;
      PSIO_REFLECT(TierOffers, free, tiers)
   };

   /// `GET /signup/:id`. `token` is set only once the invite is created.
   /// A failed signup carries no error text.
   struct SignupView
   {
      std::string                state;
      std::optional<std::string> token;
      PSIO_REFLECT(SignupView, state, token)
   };

   /// One row of `GET /admin/signups?state=failed`.
   struct FailedSignup
   {
      std::string            id;
      psibase::TimePointUSec created;
      uint32_t               attempts = 0;
      std::string            last_error;
      PSIO_REFLECT(FailedSignup, id, created, attempts, last_error)
   };

   /// `GET /me`: the signed-in X user.
   struct XIdentity
   {
      std::string x_id;
      std::string handle;
      PSIO_REFLECT(XIdentity, x_id, handle)
   };

   /// Node-local account requests.
   ///
   /// `GET /status` and `GET /tiers` are anonymous. `GET` and
   /// `PUT /admin/config` require an x-admin administrator. `PUT` sets
   /// `requests_enabled`, `price_per_token_usd_micros`, each `free_tier`, `x`,
   /// and `stripe.<mode>` field it carries, and `tiers` when present, and
   /// nothing else. It returns 400 when the result has the free tier disabled
   /// and no paid tiers.
   /// `POST /admin/agents/creator/keygen` returns `AgentKey("creator")`,
   /// creating it in `x-keys` when absent. It returns 409 when `ac-creator`
   /// already exists. `GET /admin/config` includes that key as `creator_pubkey`
   /// and `creator_allowed`, the canonical whitelist applied when `ac-creator`
   /// is created.
   ///
   /// `POST /signup` `{invite_id, payload, token, tier}` requires an X session
   /// and returns 401 when there is none. `payload` is hex. It returns 403
   /// unless `requests_enabled` and `/status` `ready` hold, and 409 when
   /// `invite_id` already exists on chain. Each signup stores that session's
   /// `x_id` and its tier's `usd_cents` and `tokens`.
   ///
   /// A free signup also returns 403 unless `free_tier.enabled`, and 409 when
   /// this X user already has a free signup that is not `failed`. It is stored
   /// `queued` (both amounts 0 when billing is disabled), and an immediate
   /// `x-timer` callback provisions it.
   ///
   /// A paid signup is stored `pending`, and x-portal creates a Stripe
   /// Embedded Checkout Session for it with the active mode's keys. It returns
   /// `CheckoutReceipt`, or 502 when Stripe does not create the session, which
   /// fails the signup with Stripe's reply as `last_error`.
   ///
   /// `POST /stripe/webhook` returns 400 unless `Stripe-Signature` carries a
   /// `v1` HMAC-SHA256 of `"<t>.<body>"` under the active mode's
   /// `webhook_secret`, with `t` within 5 minutes. A verified
   /// `checkout.session.completed` or `checkout.session.async_payment_succeeded`
   /// for a known signup records the event id. An id already recorded is
   /// ignored, so redelivery does not queue or provision the signup again.
   /// When the session is `paid` and the signup is `pending`, it becomes
   /// `queued` and is provisioned. Every verified event gets 200.
   ///
   /// Provisioning submits each signed push to this node's `transact` endpoint
   /// over a unix-socket listener, or over plain `http` when no socket is
   /// configured; see psinode's docs for listen syntax. The push prefers the
   /// unix socket, otherwise the first `http` listener. Wildcard `http`
   /// addresses are contacted on loopback; any other configured address is
   /// contacted as written. The push never uses TLS and never selects an
   /// `https` listener; an `https`-only listen list leaves no endpoint.
   ///
   /// `provision` claims each due queued signup. It commits `attempts += 1`,
   /// `last_error = "signing aborted"`, and the next `x-timer` retry — 30s,
   /// 2m, 10m, 30m, then 2h — before it pushes as `ac-creator`. When billing
   /// is enabled, that is
   /// `tokens::credit(sys, invite, cost, "x-portal signup")` with
   /// `cost = invite::getInvCost(1, tokens)`, then
   /// `invite::createInvite(invite_id, payload, 1, false, cost, tokens)`. With
   /// billing disabled, it is `createInvite` alone with zero resources and no
   /// subsidy. Success sets `invited`. A failed push stays `queued` until that
   /// retry; the push after the 2h retry sets `failed` and `last_error`. A
   /// `signTx` abort leaves the signup `queued` with the placeholder error
   /// and that retry still scheduled.
   ///
   /// `GET /signup/:id` returns `SignupView` to the owning X session. No
   /// session is 401; anything else that is not that session's signup is 404.
   /// `GET /admin/signups?state=failed` returns `FailedSignup` rows for an
   /// administrator.
   /// `POST /admin/signups/:id/retry` requeues an interrupted `queued` signup
   /// after a node restart, preserving its invite and attempt count, and
   /// reruns provisioning for a `failed` signup from attempt zero. A failed
   /// free signup returns 409 when that X user already has a free signup that
   /// is not `failed`. The route requires an administrator and rejects
   /// attempts active in this session, outstanding pushes, and invite IDs
   /// already on chain.
   ///
   /// Sign in with X is OAuth 2.0 with PKCE. `GET /auth/x/start` redirects to
   /// X's authorize page; X returns the browser to `GET /auth/x/callback`,
   /// which is 400 unless its `state` came from an unexpired start. The
   /// callback exchanges the code, reads `/2/users/me`, sets the
   /// `XPORTAL_SESSION` cookie for 7 days, and redirects to `/`. A failed X
   /// call is a 502. `GET /me` returns `XIdentity` or 401;
   /// `POST /auth/logout` ends the session.
   struct XPortal : psibase::Service
   {
      static constexpr auto service        = psibase::AccountNumber{"x-portal"};
      static constexpr auto creatorAccount = psibase::AccountNumber{"ac-creator"};
      static constexpr auto creatorAgent   = std::string_view{"creator"};

      /// Actions `ac-creator`'s key may authorize. `GET /admin/config` returns this list.
      static std::vector<SystemService::AllowedAction> creatorAllowed()
      {
         return {
             {UserService::InviteNs::Invite::service, psibase::MethodNumber{"createInvite"}},
             {UserService::InviteNs::Invite::service, psibase::MethodNumber{"delInvite"}},
             {UserService::Tokens::service, psibase::MethodNumber{"credit"}},
         };
      }

      using Subjective = psibase::SubjectiveTables<PortalConfigTable,
                                                   AgentKeyTable,
                                                   SignupTable,
                                                   XAuthRequestTable,
                                                   XUserTable,
                                                   XSessionTable>;
      using Session    = psibase::SessionTables<PendingPushTable,
                                                PendingXRequestTable,
                                                PendingStripeRequestTable,
                                                ProvisionAttemptTable>;

      std::optional<psibase::HttpReply> serveSys(psibase::HttpRequest                  request,
                                                 std::optional<std::int32_t>           socket,
                                                 std::optional<psibase::AccountNumber> user);

      // x-timer callbacks
      void provision(std::uint64_t timer);

      // x-http callbacks for pushed transactions
      void onPushReply(std::int32_t socket, psibase::HttpReply reply);
      void onPushError(std::int32_t socket);

      // x-http callbacks for X sign-in requests
      void onXToken(std::int32_t socket, psibase::HttpReply reply);
      void onXUser(std::int32_t socket, psibase::HttpReply reply);
      void onXError(std::int32_t socket);

      // x-http callbacks for Stripe Checkout Session requests
      void onStripeSession(std::int32_t socket, psibase::HttpReply reply);
      void onStripeError(std::int32_t socket);
   };
   PSIO_REFLECT(XPortal,
                method(serveSys, request, socket, user),
                method(provision, timer),
                method(onPushReply, socket, reply),
                method(onPushError, socket),
                method(onXToken, socket, reply),
                method(onXUser, socket, reply),
                method(onXError, socket),
                method(onStripeSession, socket, reply),
                method(onStripeError, socket))
   PSIBASE_REFLECT_TABLES(XPortal, XPortal::Subjective, XPortal::Session)
}  // namespace LocalService
