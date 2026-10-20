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

   struct PortalConfig
   {
      bool                    requests_enabled = false;
      std::optional<uint64_t> price_per_token_usd_micros;
      TierConfig              free_tier;
      PSIO_REFLECT(PortalConfig, requests_enabled, price_per_token_usd_micros, free_tier)
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
   struct Signup
   {
      psibase::Checksum256   id;
      uint32_t               invite_id = 0;
      std::vector<uint8_t>   payload;
      std::string            token;
      uint64_t               usd_cents = 0;
      UserService::Quantity  tokens;
      std::string            state;
      uint32_t               attempts = 0;
      std::string            last_error;
      psibase::TimePointUSec created;
      psibase::TimePointUSec updated;
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
                   updated)
   };
   using SignupTable = psibase::Table<Signup, &Signup::id>;
   PSIO_REFLECT_TYPENAME(SignupTable)

   /// An agent transaction sent to `transact` that has no final reply yet.
   /// `signup` is set when the push provisions a signup record.
   struct PendingPush
   {
      std::int32_t           socket;
      psibase::Checksum256   signup;
      PSIO_REFLECT(PendingPush, socket, signup)
   };
   using PendingPushTable = psibase::Table<PendingPush, &PendingPush::socket>;
   PSIO_REFLECT_TYPENAME(PendingPushTable)

   /// `GET /admin/config`. `tokens` is computed; it is not stored.
   struct TierView
   {
      bool                                 enabled = true;
      std::optional<uint64_t>              usd_cents;
      std::optional<UserService::Quantity> tokens;
      PSIO_REFLECT(TierView, enabled, usd_cents, tokens)
   };

   struct AdminConfig
   {
      bool                                  requests_enabled = false;
      std::optional<uint64_t>               price_per_token_usd_micros;
      TierView                              free_tier;
      std::optional<psibase::AccountNumber> producer;
      std::optional<psibase::AccountNumber> account;
      /// PEM public key once `POST /admin/agents/creator/keygen` has stored one.
      std::optional<SystemService::AuthSig::SubjectPublicKeyInfo> creator_pubkey;
      /// Canonical whitelist applied when `ac-creator` is created. Not the on-chain row.
      std::vector<SystemService::AllowedAction> creator_allowed;
      PSIO_REFLECT(AdminConfig,
                   requests_enabled,
                   price_per_token_usd_micros,
                   free_tier,
                   producer,
                   account,
                   creator_pubkey,
                   creator_allowed)
   };

   struct Condition
   {
      std::string id;
      bool        ok = false;
      PSIO_REFLECT(Condition, id, ok)
   };

   /// `GET /status`. Conditions carry an id and whether it holds, and nothing else.
   /// When billing is disabled, only `creator_ready` is present. When billing is
   /// enabled, `creator_tokens` and `creator_resources` are added.
   struct Status
   {
      bool                   requests_enabled = false;
      bool                   billing_enabled  = false;
      bool                   ready            = false;
      std::vector<Condition> conditions;
      PSIO_REFLECT(Status, requests_enabled, billing_enabled, ready, conditions)
   };

   /// `POST /signup` body. A missing field is a 400, not a default.
   struct SignupBody
   {
      std::optional<uint32_t>             invite_id;
      std::optional<std::vector<uint8_t>> payload;
      std::optional<std::string>          token;
      PSIO_REFLECT(SignupBody, invite_id, payload, token)
   };

   /// `POST /signup` returns the new signup's id, base64url of its 32 bytes.
   struct SignupReceipt
   {
      std::string signup_id;
      PSIO_REFLECT(SignupReceipt, signup_id)
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

   /// Node-local account requests.
   ///
   /// `GET /status` is anonymous. `GET` and `PUT /admin/config` require an
   /// x-admin administrator. `PUT` changes only `requests_enabled`.
   /// `POST /admin/agents/creator/keygen` returns `AgentKey("creator")`,
   /// creating it in `x-keys` when absent. It returns 409 when `ac-creator`
   /// already exists. `GET /admin/config` includes that key as `creator_pubkey`
   /// and `creator_allowed`, the canonical whitelist applied when `ac-creator`
   /// is created.
   ///
   /// `POST /signup` `{invite_id, payload, token}` is anonymous; `payload` is
   /// hex. It returns 403 unless `requests_enabled`, `free_tier.enabled`, and
   /// `/status` `ready` all hold, and 409 when `invite_id` already exists on
   /// chain. The signup is stored `queued` with the free tier's `usd_cents` and
   /// `tokens` (both 0 when billing is disabled). An immediate `x-timer`
   /// callback provisions it.
   ///
   /// `provision` attempts each due queued signup once. It commits
   /// `attempts += 1` and `last_error = "signing aborted"`, then pushes as
   /// `ac-creator`. When billing is enabled, that is
   /// `tokens::credit(sys, invite, cost, "x-portal signup")` with
   /// `cost = invite::getInvCost(1, tokens)`, then
   /// `invite::createInvite(invite_id, payload, 1, false, cost, tokens)`. With
   /// billing disabled, it is `createInvite` alone with zero resources and no
   /// subsidy. Success sets `invited`. A failed push sets `failed` and
   /// `last_error`. A `signTx` abort leaves the signup `queued` with the
   /// placeholder error.
   ///
   /// `GET /signup/:id` returns `SignupView`. `GET /admin/signups?state=failed`
   /// returns `FailedSignup` rows for an administrator.
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

      using Subjective = psibase::SubjectiveTables<PortalConfigTable, AgentKeyTable, SignupTable>;
      using Session = psibase::SessionTables<PendingPushTable>;

      std::optional<psibase::HttpReply> serveSys(psibase::HttpRequest                  request,
                                                 std::optional<std::int32_t>           socket,
                                                 std::optional<psibase::AccountNumber> user);

      // x-timer callbacks
      void provision(std::uint64_t timer);

      // x-http callbacks for pushed transactions
      void onPushReply(std::int32_t socket, psibase::HttpReply reply);
      void onPushError(std::int32_t socket);
   };
   PSIO_REFLECT(XPortal,
                method(serveSys, request, socket, user),
                method(provision, timer),
                method(onPushReply, socket, reply),
                method(onPushError, socket))
   PSIBASE_REFLECT_TABLES(XPortal, XPortal::Subjective, XPortal::Session)
}  // namespace LocalService
