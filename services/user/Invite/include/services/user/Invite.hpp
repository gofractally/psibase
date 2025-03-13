#pragma once

#include <psibase/Rpc.hpp>
#include <psibase/psibase.hpp>

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
             psibase::ServiceTables<InviteSettingsTable, InviteTable, InitTable, NewAccTable>;
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
         ///
         /// Parameters:
         /// - `inviteKey` is the public key of the invite.
         /// - `id` is an optional secondary identifier for the invite.
         /// - `secret` is an optional secret for the invite.
         /// - `app` is the account responsible for creating the invite. It is optional because it may
         ///   not be able to be determined.
         /// - `appDomain` is the domain of the app that created the invite.
         void createInvite(Spki                                  inviteKey,
                           std::optional<uint32_t>               id,
                           std::optional<std::string>            secret,
                           std::optional<psibase::AccountNumber> app,
                           std::optional<std::string>            appDomain);

         /// Called by existing Psibase accounts to accept an invite without creating
         /// a new Psibase account
         void accept(Spki inviteKey);

         /// Called by the system account "invited-sys" to accept an invite and
         /// simultaneously create the new account 'acceptedBy', which is
         /// authenticated by the provided 'newAccountKey' public key
         ///
         /// Each invite may be used to redeem a maximum of one new account.
         void acceptCreate(Spki inviteKey, psibase::AccountNumber acceptedBy, Spki newAccountKey);

         /// Called by existing accounts or the system account "invited-sys" to reject
         /// an invite. Once an invite is rejected, it cannot be accepted or used to
         /// create a new account
         void reject(Spki inviteKey);

         /// Used by the creator of an invite to delete it. Deleted invites are removed
         /// from the database. An invite can be deleted regardless of whether it has been
         /// accepted, rejected, or is still pending
         void delInvite(Spki inviteKey);

         /// Used by anyone to garbage collect expired invites. Up to 'maxDeleted' invites
         /// can be deleted by calling this action
         void delExpired(uint32_t maxDeleted);

         /// Called by this service itself to restrict the accounts that are
         /// able to create invites. Only whitelisted accounts may create
         /// invites
         void setWhitelist(std::vector<psibase::AccountNumber> accounts);

         /// Called by this service itself to restrict the accounts that are
         /// able to create invites. Blacklisted accounts may not create invites
         void setBlacklist(std::vector<psibase::AccountNumber> accounts);

         /// Called synchronously by other services to retrieve the invite
         /// record corresponding to the provided 'pubkey' public key
         std::optional<InviteRecord> getInvite(Spki pubkey);

         /// Called synchronously by other services to query whether the invite
         /// record corresponding to the provided `pubkey` public key is expired
         bool isExpired(Spki pubkey);

         /// Called synchronously by other services to query whether the specified
         /// actor should be allowed to claim the invite specified by the `pubkey`
         /// public key.
         ///
         /// To be considered a valid interaction, the following criteria must be met:
         /// * The invite must exist
         /// * The invite must be in the accepted state
         /// * The invite actor must be the same as the specified `actor` parameter
         /// * The invite must not be expired
         void checkClaim(psibase::AccountNumber actor, Spki pubkey);

         /// Called by the http-server system service when an HttpRequest
         /// is directed at this invite service
         std::optional<psibase::HttpReply> serveSys(psibase::HttpRequest request);

         // clang-format off
         struct Events
         {
            using AccountNumber = psibase::AccountNumber;
            struct History
            {
               void inviteCreated(Spki inviteKey,
                                 AccountNumber inviter);
               void inviteDeleted(Spki inviteKey);
               void expInvDeleted(uint32_t  numCheckedRows,
                                 uint32_t  numDeleted);
               void inviteAccepted(Spki inviteKey,
                                 AccountNumber accepter);
               void inviteRejected(Spki     inviteKey);
               void whitelistSet(std::vector<AccountNumber> accounts);
               void blacklistSet(std::vector<AccountNumber> accounts);
            };
            struct Ui {};
            struct Merkle {};
         };
         // clang-format on
      };

      // clang-format off
      PSIO_REFLECT(Invite,
         method(init),
         method(createInvite, inviteKey, id, secret, app, appDomain),
         method(accept, inviteKey),
         method(acceptCreate, inviteKey, acceptedBy, newAccountKey),
         method(reject, inviteKey),
         method(delInvite, inviteKey),
         method(delExpired, maxDeleted),
         method(getInvite, pubkey),
         method(isExpired, pubkey),
         method(checkClaim, actor, pubkey),
         method(serveSys, request),
         method(setWhitelist, accounts),
         method(setBlacklist, accounts)
      );
      PSIBASE_REFLECT_EVENTS(Invite);
      PSIBASE_REFLECT_HISTORY_EVENTS(Invite,
         method(inviteCreated, inviteKey, inviter),
         method(inviteDeleted, inviteKey),
         method(expInvDeleted, numCheckedRows, numDeleted),
         method(inviteAccepted, inviteKey, accepter),
         method(inviteRejected, inviteKey),
         method(whitelistSet, accounts),
         method(blacklistSet, accounts)
      );
      PSIBASE_REFLECT_UI_EVENTS(Invite);
      PSIBASE_REFLECT_MERKLE_EVENTS(Invite);
      PSIBASE_REFLECT_TABLES(Invite, Invite::Tables)
      // clang-format on
   }  // namespace InviteNs

}  // namespace UserService
