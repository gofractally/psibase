#pragma once

#include <optional>
#include <psibase/Rpc.hpp>
#include <psibase/Service.hpp>
#include <psibase/crypto.hpp>
#include <psibase/time.hpp>
#include <services/system/Spki.hpp>
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

   /// A signup record. Ids are 32 bytes.
   struct Signup
   {
      psibase::Checksum256                  id;
      psibase::AccountNumber                name;
      std::string                           pubkey_pem;
      uint64_t                              usd_cents = 0;
      UserService::Quantity                 tokens;
      std::string                           state;
      std::optional<psibase::AccountNumber> account;
      uint32_t                              attempts = 0;
      std::string                           last_error;
      psibase::TimePointUSec                created;
      psibase::TimePointUSec                updated;
      PSIO_REFLECT(Signup,
                   id,
                   name,
                   pubkey_pem,
                   usd_cents,
                   tokens,
                   state,
                   account,
                   attempts,
                   last_error,
                   created,
                   updated)
   };
   using SignupTable = psibase::Table<Signup, &Signup::id>;
   PSIO_REFLECT_TYPENAME(SignupTable)

   /// Agents whose one-time setup push has been scheduled. It never runs twice.
   struct AgentSetup
   {
      std::string name;
      PSIO_REFLECT(AgentSetup, name)
   };
   using AgentSetupTable = psibase::Table<AgentSetup, &AgentSetup::name>;
   PSIO_REFLECT_TYPENAME(AgentSetupTable)

   /// An admin request waiting for a push's final result
   struct PushReplyTo
   {
      std::int32_t                     socket;
      std::vector<psibase::HttpHeader> headers;
      PSIO_REFLECT(PushReplyTo, socket, headers)
   };

   /// An agent transaction sent to `transact` that has no final reply yet.
   /// `signup` is set when the push provisions a signup record.
   struct PendingPush
   {
      std::int32_t                        socket;
      std::optional<PushReplyTo>          replyTo;
      std::optional<psibase::Checksum256> signup;
      PSIO_REFLECT(PendingPush, socket, replyTo, signup)
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
      PSIO_REFLECT(AdminConfig,
                   requests_enabled,
                   price_per_token_usd_micros,
                   free_tier,
                   producer,
                   account)
   };

   struct Condition
   {
      std::string id;
      bool        ok = false;
      PSIO_REFLECT(Condition, id, ok)
   };

   /// `GET /status`. Conditions carry an id and whether it holds, and nothing else.
   struct Status
   {
      bool                   requests_enabled = false;
      bool                   billing_enabled  = false;
      bool                   ready            = false;
      std::vector<Condition> conditions;
      PSIO_REFLECT(Status, requests_enabled, billing_enabled, ready, conditions)
   };

   /// `POST /signup` returns the new signup's id, base64url of its 32 bytes.
   struct SignupReceipt
   {
      std::string signup_id;
      PSIO_REFLECT(SignupReceipt, signup_id)
   };

   /// `GET /signup/:id`. `account` is set only after the account is created.
   /// A failed signup carries no error text.
   struct SignupView
   {
      std::string                           state;
      std::optional<psibase::AccountNumber> account;
      PSIO_REFLECT(SignupView, state, account)
   };

   /// One row of `GET /admin/signups?state=failed`.
   struct FailedSignup
   {
      std::string            id;
      psibase::AccountNumber name;
      psibase::TimePointUSec created;
      uint32_t               attempts = 0;
      std::string            last_error;
      PSIO_REFLECT(FailedSignup, id, name, created, attempts, last_error)
   };

   /// Node-local account requests.
   ///
   /// `GET /status` is anonymous. `GET` and `PUT /admin/config` require an
   /// x-admin administrator. `PUT` changes only `requests_enabled`.
   /// `POST /admin/agents/creator/keygen` returns `AgentKey("creator")`,
   /// creating it in `x-keys` when absent. It returns 409 when `ac-creator`
   /// already exists.
   ///
   /// `POST /admin/agents/creator/test` pushes the `ac-creator` setup
   /// transaction (enable auto-debit and debit any pending producer credit)
   /// and replies with its JSON trace once final. The same push runs once on
   /// its own when `creator_ready` first reports `ok`.
   ///
   /// `POST /signup` `{name, pubkey_pem}` is anonymous. It returns 403 unless
   /// `requests_enabled`, `free_tier.enabled`, and `/status` `ready` all hold.
   /// `name` must be 8 to 10 `[a-z0-9-]` characters, with no leading or
   /// trailing hyphen and no `--`, and must name no existing account. The
   /// signup is stored `queued` with the free tier's `usd_cents` and `tokens`
   /// (both 0 when billing is disabled). An immediate `x-timer` callback
   /// provisions it.
   ///
   /// `provision` attempts each due queued signup once. It commits
   /// `attempts += 1` and `last_error = "signing aborted"`, then pushes as
   /// `ac-creator`: `auth-sig::newAccount(name, pubkey)` and, when billing is
   /// enabled, `tokens::credit(sys, vserver, tokens, "x-portal signup")` and
   /// `vserver::buy_res_for(tokens, name, "x-portal signup")`. Success sets
   /// `created` and `account`. A failed push sets `failed` and `last_error`.
   /// A `signTx` abort leaves the signup `queued` with the placeholder error.
   ///
   /// `GET /signup/:id` returns `SignupView`. `GET /admin/signups?state=failed`
   /// returns `FailedSignup` rows for an administrator.
   struct XPortal : psibase::Service
   {
      static constexpr auto service        = psibase::AccountNumber{"x-portal"};
      static constexpr auto creatorAccount = psibase::AccountNumber{"ac-creator"};
      static constexpr auto creatorAgent   = std::string_view{"creator"};

      using Subjective =
          psibase::SubjectiveTables<PortalConfigTable, AgentKeyTable, SignupTable, AgentSetupTable>;
      using Session = psibase::SessionTables<PendingPushTable>;

      std::optional<psibase::HttpReply> serveSys(psibase::HttpRequest                  request,
                                                 std::optional<std::int32_t>           socket,
                                                 std::optional<psibase::AccountNumber> user);

      // x-timer callbacks
      void creatorSetup(std::uint64_t timer);
      void provision(std::uint64_t timer);

      // x-http callbacks for pushed transactions
      void onPushReply(std::int32_t socket, psibase::HttpReply reply);
      void onPushError(std::int32_t socket);
   };
   PSIO_REFLECT(XPortal,
                method(serveSys, request, socket, user),
                method(creatorSetup, timer),
                method(provision, timer),
                method(onPushReply, socket, reply),
                method(onPushError, socket))
   PSIBASE_REFLECT_TABLES(XPortal, XPortal::Subjective, XPortal::Session)
}  // namespace LocalService
