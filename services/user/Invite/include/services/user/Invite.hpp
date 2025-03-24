#pragma once

#include <psibase/Rpc.hpp>
#include <psibase/psibase.hpp>
#include <psibase/time.hpp>

#include <services/system/Accounts.hpp>
#include <services/system/CommonTables.hpp>
#include <services/user/InviteErrors.hpp>
#include <services/user/InviteTables.hpp>

namespace UserService
{
   namespace InviteNs
   {
      /// This service facilitates the creation and redemption of invites
      ///
      /// Invites are generic and their acceptance can, but does not always, result
      /// in the creation of a new Psibase account. This service can be used
      /// by third party applications to streamline their user onboarding.
      ///
      /// Only this system service and Accounts are permitted to create new accounts.
      class Invite : public psibase::Service
      {
        public:
         using Tables =
             psibase::ServiceTables<InviteTable, InitTable, NewAccTable, NextInviteIdTable>;
         /// "invite"
         static constexpr auto service = SystemService::Accounts::inviteService;
         /// "invited-sys"
         static constexpr auto payerAccount = psibase::AccountNumber("invited-sys");

         /// Constructor prevents actions from being called until after init() has
         /// been called
         Invite(psio::shared_view_ptr<psibase::Action> action);

         /// Called once during chain initialization
         ///
         /// 1. Registers this service as an RPC/gql query handler
         /// 2. Configures itself for manual debiting
         /// 3. Creates the "invites-sys" system account used to create new accounts
         void init();

         /// Creates and stores a new invite object that can be used to create a new account
         /// Returns the ID of the newly created invite
         ///
         /// Parameters:
         /// - `inviteKey` is the public key of the invite.
         /// - `id` is an optional secondary identifier for the invite.
         /// - `secret` is an optional secret for the invite.
         /// - `app` is the account responsible for creating the invite. It is optional because it may
         ///   not be able to be determined.
         /// - `appDomain` is the domain of the app that created the invite.
         uint32_t createInvite(Spki                                  inviteKey,
                               std::optional<uint32_t>               secondaryId,
                               std::optional<std::string>            secret,
                               std::optional<psibase::AccountNumber> app,
                               std::optional<std::string>            appDomain);

         /// Called by existing Psibase accounts to accept an invite without creating
         /// a new Psibase account
         void accept(uint32_t inviteId);

         /// Called by the system account "invited-sys" to accept an invite and
         /// simultaneously create the new account 'acceptedBy', which is
         /// authenticated by the provided 'newAccountKey' public key
         ///
         /// Each invite may be used to redeem a maximum of one new account.
         void acceptCreate(uint32_t               inviteId,
                           psibase::AccountNumber acceptedBy,
                           Spki                   newAccountKey);

         /// Called by existing accounts or the system account "invited-sys" to reject
         /// an invite. Once an invite is rejected, it cannot be accepted or used to
         /// create a new account
         void reject(uint32_t inviteId);

         /// Used by the creator of an invite to delete it. Deleted invites are removed
         /// from the database. An invite can be deleted regardless of whether it has been
         /// accepted, rejected, or is still pending
         void delInvite(uint32_t inviteId);

         /// Used by anyone to garbage collect expired invites. Up to 'maxDeleted' invites
         /// can be deleted by calling this action
         void delExpired(uint32_t maxDeleted);

         /// Called synchronously by other services to retrieve the invite
         /// record corresponding to the provided 'pubkey' public key
         std::optional<InviteRecord> getInvite(uint32_t inviteId);

         /// Called synchronously by other services to query whether the invite
         /// record corresponding to the provided `pubkey` public key is expired
         bool isExpired(uint32_t inviteId);

         /// Called synchronously by other services to query whether the specified
         /// actor should be allowed to claim the invite specified by the `pubkey`
         /// public key.
         ///
         /// To be considered a valid interaction, the following criteria must be met:
         /// * The invite must exist
         /// * The invite must be in the accepted state
         /// * The invite actor must be the same as the specified `actor` parameter
         /// * The invite must not be expired
         void checkClaim(psibase::AccountNumber actor, uint32_t inviteId);

         // clang-format off
         struct Events
         {
            struct History
            {
               void updated(uint32_t inviteId, psibase::AccountNumber actor, psibase::TimePointUSec datetime, std::string_view event);
            };
            struct Ui {};
            struct Merkle {};
         };
         // clang-format on
      };

      // clang-format off
      PSIO_REFLECT(Invite,
         method(init),
         method(createInvite, inviteKey, secondaryId, secret, app, appDomain),
         method(accept, inviteId),
         method(acceptCreate, inviteId, acceptedBy, newAccountKey),
         method(reject, inviteId),
         method(delInvite, inviteId),
         method(delExpired, maxDeleted),
         method(getInvite, inviteId),
         method(isExpired, inviteId),
         method(checkClaim, actor, inviteId),
      );
      PSIBASE_REFLECT_EVENTS(Invite);
      PSIBASE_REFLECT_HISTORY_EVENTS(Invite,
         method(updated, inviteId, actor, datetime, event),
      );
      PSIBASE_REFLECT_UI_EVENTS(Invite);
      PSIBASE_REFLECT_MERKLE_EVENTS(Invite);
      // clang-format on
   }  // namespace InviteNs

}  // namespace UserService
