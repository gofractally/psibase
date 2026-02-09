#pragma once

#include <psibase/Rpc.hpp>
#include <psibase/psibase.hpp>
#include <psibase/time.hpp>

#include <services/system/Accounts.hpp>
#include <services/system/CommonTables.hpp>
#include <services/user/InviteErrors.hpp>
#include <services/user/InviteTables.hpp>
#include <services/user/tokenTypes.hpp>

namespace UserService
{
   namespace InviteNs
   {

      /// This interface should be implemented by a service that wants to handle hooks from the invite service
      /// to be notified when an event occurs related to an invite.
      struct InviteHooks
      {
         /// Called on the invite creator when the invite is accepted
         void onInvAccept(uint32_t inviteId, psibase::AccountNumber accepter);
      };
      PSIO_REFLECT(InviteHooks, method(onInvAccept, inviteId, accepter))

      /// This service facilitates the creation and redemption of invites
      ///
      /// Invites are generic and their acceptance can, but does not always, result
      /// in the creation of a new account. This service can be used
      /// by third party applications to streamline their user onboarding.
      class Invite : public psibase::Service
      {
        public:
         using Tables = psibase::ServiceTables<InviteTable, InitTable>;

         static constexpr auto service = SystemService::Accounts::inviteService;

         Invite(psio::shared_view_ptr<psibase::Action> action);

         void init();

         /// Returns the current minimum cost of creating an invite that can create the specified number of
         /// accounts.
         Quantity getInvCost(uint16_t numAccounts);

         /// Creates and stores a new invite object that can be used to create new accounts
         /// Returns the ID of the newly created invite
         ///
         /// Parameters:
         /// - `inviteId` is the id of the invite (could be randomly generated)
         /// - `fingerprint` is the fingerprint of the invite public key
         /// - `numAccounts` is the number of accounts this invite can be used to create
         /// - `useHooks` is a flag that indicates whether to use hooks to notify the caller when
         ///    the invite is updated
         /// - `secret` is an encrypted secret used to redeem the invite
         /// - `resources` is the amount of resources stored in the invite (used when creating
         ///               new accounts). The caller must send this amount of system tokens to this
         ///               invite service before calling this action. Use the query interface to check
         ///               the resources required for an invite of the specified number of accounts.
         ///
         /// If `useHooks` is true, the caller must be an account with a service deployed on it
         /// that implements the InviteHooks interface.
         uint32_t createInvite(uint32_t              inviteId,
                               psibase::Checksum256  fingerprint,
                               uint16_t              numAccounts,
                               bool                  useHooks,
                               std::string           secret,
                               UserService::Quantity resources);

         /// Called by an invite credential (not a user account) to create the specified
         /// account. The new account is authorized by the specified public key.
         void createAccount(psibase::AccountNumber account, Spki accountKey);

         /// The sender accepts an invite.
         /// Calling this action also requires that the sender authorizes the transaction with the
         /// proof for the credential associated with the invite.
         void accept(uint32_t inviteId);

         /// Delete the invite and its secret (if applicable).
         /// Can only be called by the invite creator.
         void delInvite(uint32_t inviteId);

         /// Called synchronously by other services to retrieve the specified invite record
         std::optional<InviteRecord> getInvite(uint32_t inviteId);

         // clang-format off
         struct Events
         {
            struct History
            {
               void updated(uint32_t inviteId, psibase::AccountNumber actor, std::string_view event);
            };
            struct Ui {};
            struct Merkle {};
         };
         // clang-format on
      };

      // clang-format off
      PSIO_REFLECT(Invite,
         method(init),
         method(getInvCost, numAccounts),
         method(createInvite, inviteId, fingerprint, numAccounts, useHooks, secret, resources),
         method(createAccount, account, accountKey),
         method(accept, inviteId),
         method(delInvite, inviteId),
         method(getInvite, inviteId),
      );
      PSIBASE_REFLECT_EVENTS(Invite);
      PSIBASE_REFLECT_HISTORY_EVENTS(Invite,
         method(updated, inviteId, actor, event),
      );
      PSIBASE_REFLECT_UI_EVENTS(Invite);
      PSIBASE_REFLECT_MERKLE_EVENTS(Invite);
      PSIBASE_REFLECT_TABLES(Invite, Invite::Tables)
      // clang-format on
   }  // namespace InviteNs

}  // namespace UserService
