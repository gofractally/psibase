#pragma once

#include <psibase/Rpc.hpp>
#include <psibase/psibase.hpp>

#include <services/system/Accounts.hpp>
#include <services/system/CommonTables.hpp>
#include <services/user/InviteErrors.hpp>
#include <services/user/InviteTables.hpp>

namespace UserService
{
   namespace Invite
   {

      /// This service facilitates the creation and redemption of invites
      ///
      /// Invites are generic and their acceptance can, but does not always, result
      /// in the creation of a new Psibase account. This service can be used
      /// by third party applications to streamline their user onboarding.
      ///
      /// Only this system service and Accounts are permitted to create new accounts.
      class InviteSys : public psibase::Service<InviteSys>
      {
        public:
         using Tables = psibase::ServiceTables<InviteSettingsTable,
                                               InviteTable,
                                               UserEventTable,
                                               ServiceEventTable,
                                               InitTable,
                                               NewAccTable,
                                               psibase::WebContentTable>;
         /// "invite-sys"
         static constexpr auto service = SystemService::Accounts::inviteService;
         /// "invited-sys"
         static constexpr auto payerAccount = psibase::AccountNumber("invited-sys");

         /// Constructor prevents actions from being called until after init() has
         /// been called
         InviteSys(psio::shared_view_ptr<psibase::Action> action);

         /// Called once during chain initialization
         ///
         /// 1. Registers this service as an RPC/gql query handler
         /// 2. Configures itself for manual debiting
         /// 3. Creates the "invites-sys" system account used to create new accounts
         void init();

         /// Creates and stores an invite object with the specified public key
         void createInvite(psibase::PublicKey inviteKey);

         /// Called by existing Psibase accounts to accept an invite without creating
         /// a new Psibase account
         void accept(psibase::PublicKey inviteKey);

         /// Called by the system account "invited-sys" to accept an invite and
         /// simultaneously create the new account 'acceptedBy', which is
         /// authenticated by the provided 'newAccountKey' public key
         ///
         /// Each invite may be used to redeem a maximum of one new account.
         void acceptCreate(psibase::PublicKey     inviteKey,
                           psibase::AccountNumber acceptedBy,
                           psibase::PublicKey     newAccountKey);

         /// Called by existing accounts or the system account "invited-sys" to reject
         /// an invite. Once an invite is rejected, it cannot be accepted or used to
         /// create a new account
         void reject(psibase::PublicKey inviteKey);

         /// Used by the creator of an invite to delete it. Deleted invites are removed
         /// from the database. An invite can be deleted regardless of whether it has been
         /// accepted, rejected, or is still pending
         void delInvite(psibase::PublicKey inviteKey);

         /// Used by anyone to garbage collect expired invites. Up to 'maxDeleted' invites
         /// can be deleted by calling this action
         void delExpired(uint32_t maxDeleted);

         /// Called by this service itself to restrict the accounts that are
         /// able to create invites. Only whitelisted accounts may create
         /// invites
         void setWhitelist(std::vector<psibase::AccountNumber> accounts);

         /// Called by this service itself to restruct the accounts that are
         /// able to create invites. Blacklisted accounts may not create invites
         void setBlacklist(std::vector<psibase::AccountNumber> accounts);

         /// Called synchronously by other services to retrieve the invite
         /// record corresponding to the provided 'pubkey' public key
         std::optional<InviteRecord> getInvite(psibase::PublicKey pubkey);

         /// Called synchronously by other services to query whether the invite
         /// record corresponding to the provided `pubkey` public key is expired
         bool isExpired(psibase::PublicKey pubkey);

         /// Called synchronously by other services to query whether the specified
         /// actor should be allowed to claim the invite specified by the `pubkey`
         /// public key.
         ///
         /// To be considered a valid interaction, the following criteria must be met:
         /// * The invite must exist
         /// * The invite must be in the accepted state
         /// * The invite actor must be the same as the specified `actor` parameter
         /// * The invite must not be expired
         void checkClaim(psibase::AccountNumber actor, psibase::PublicKey pubkey);

         /// Called by the proxy-sys system service when an HttpRequest
         /// is directed at this invite service
         std::optional<psibase::HttpReply> serveSys(psibase::HttpRequest request);

         /// Used to store UI files and other `content` at the specified `path`.
         void storeSys(std::string path, std::string contentType, std::vector<char> content);

         // clang-format off
         struct Events
         {
            struct History
            {
               void inviteCreated(uint64_t               prevEvent,
                                 psibase::PublicKey     inviteKey,
                                 psibase::AccountNumber inviter);
               void inviteDeleted(uint64_t               prevEvent,
                                 psibase::PublicKey     inviteKey);
               void expInvDeleted(uint64_t               prevEvent,
                                 uint32_t               numCheckedRows,
                                 uint32_t               numDeleted);
               void inviteAccepted(uint64_t              prevEvent,
                                 psibase::PublicKey     inviteKey,
                                 psibase::AccountNumber accepter);
               void inviteRejected(uint64_t              prevEvent,
                                 psibase::PublicKey     inviteKey);
               void whitelistSet(uint64_t                prevEvent,
                                 std::vector<psibase::AccountNumber> accounts);
               void blacklistSet(uint64_t                prevEvent,
                                 std::vector<psibase::AccountNumber> accounts);
            };
            struct Ui {};
            struct Merkle {};
         };
         // clang-format on
         using UserEvents    = psibase::EventIndex<&UserEventRecord::eventHead, "prevEvent">;
         using ServiceEvents = psibase::EventIndex<&ServiceEventRecord::eventHead, "prevEvent">;
      };

      // clang-format off
      PSIO_REFLECT(InviteSys,
         method(init),
         method(createInvite, inviteKey, inviter),
         method(accept, inviteKey),
         method(acceptCreate, inviteKey, acceptedBy, newAccountKey),
         method(reject, inviteKey),
         method(delInvite, inviteKey),
         method(delExpired, maxDeleted),
         method(getInvite, pubkey),
         method(isExpired, pubkey),
         method(checkClaim, actor, pubkey),
         method(serveSys, request),
         method(storeSys, path, contentType, content),
         method(setWhitelist, accounts),
         method(setBlacklist, accounts)
      );
      PSIBASE_REFLECT_EVENTS(InviteSys);
      PSIBASE_REFLECT_HISTORY_EVENTS(InviteSys,
         method(inviteCreated, prevEvent, inviteKey, inviter),
         method(inviteDeleted, prevEvent, inviteKey),
         method(expInvDeleted, prevEvent, numCheckedRows, numDeleted),
         method(inviteAccepted, prevEvent, inviteKey, accepter),
         method(inviteRejected, prevEvent, inviteKey),
         method(whitelistSet, prevEvent, accounts),
         method(blacklistSet, prevEvent, accounts)
      );
      PSIBASE_REFLECT_UI_EVENTS(InviteSys);
      PSIBASE_REFLECT_MERKLE_EVENTS(InviteSys);
      // clang-format on
   }  // namespace Invite

}  // namespace UserService
