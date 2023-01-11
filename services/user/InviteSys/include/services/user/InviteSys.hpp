#pragma once

#include <psibase/Rpc.hpp>
#include <psibase/String.hpp>
#include <psibase/psibase.hpp>

#include <services/system/CommonTables.hpp>
#include <services/user/InviteErrors.hpp>
#include <services/user/InviteTables.hpp>

namespace UserService
{
   namespace Invite
   {
      class InviteSys : public psibase::Service<InviteSys>
      {
        public:
         using Tables                       = psibase::ServiceTables<InviteSettingsTable,
                                               InviteTable,
                                               UserEventTable,
                                               ServiceEventTable,
                                               InitTable>;
         static constexpr auto service      = psibase::AccountNumber("invite-sys");
         static constexpr auto payerAccount = psibase::AccountNumber("invited-sys");

         InviteSys(psio::shared_view_ptr<psibase::Action> action);

         void init();

         void createInvite(psibase::PublicKey inviteKey, psibase::AccountNumber inviter);

         void acceptCreate(psibase::PublicKey     inviteKey,
                           psibase::AccountNumber newAccountName,
                           psibase::PublicKey     newAccountKey);

         void accept(psibase::PublicKey inviteKey);

         void reject(psibase::PublicKey inviteKey);

         void delInvite(psibase::PublicKey inviteKey);

         void delExpired(uint32_t maxDeleted);

         // If the whitelist is nonempty, accounts that are capable of creating invites are
         // restricted to the whitelist
         void setWhitelist(std::vector<psibase::AccountNumber> accounts);

         // If the blacklist is nonempty, any accounts it contains are unable to create invites
         void setBlacklist(std::vector<psibase::AccountNumber> accounts);

         std::optional<InviteRecord> getInvite(psibase::PublicKey pubkey);

         std::optional<psibase::HttpReply> serveSys(psibase::HttpRequest request);

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
                               psibase::PublicKey     inviteKey);
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

        private:
         enum AccepterType
         {
            newAccount,
            existingAccount
         };

         void acceptInvite(psibase::PublicKey     inviteKey,
                           psibase::AccountNumber acceptedBy,
                           AccepterType           accepterType);
      };

      // clang-format off
      PSIO_REFLECT(InviteSys,
         method(init),
         method(createInvite, inviteKey, inviter),
         method(acceptCreate, inviteKey, newAccountName, newAccountKey),
         method(accept, inviteKey),
         method(reject, inviteKey),
         method(delInvite, inviteKey),
         method(delExpired, maxDeleted),
         method(getInvite, pubkey),
         method(serveSys, request),
         method(setWhitelist, accounts),
         method(setBlacklist, accounts)
      );
      PSIBASE_REFLECT_EVENTS(InviteSys);
      PSIBASE_REFLECT_HISTORY_EVENTS(InviteSys,
         method(inviteCreated, prevEvent, inviteKey, inviter),
         method(inviteDeleted, prevEvent, inviteKey),
         method(expInvDeleted, prevEvent, numCheckedRows, numDeleted),
         method(inviteAccepted, prevEvent, inviteKey),
         method(inviteRejected, prevEvent, inviteKey),
         method(whitelistSet, prevEvent, accounts),
         method(blacklistSet, prevEvent, accounts)
      );
      PSIBASE_REFLECT_UI_EVENTS(InviteSys);
      PSIBASE_REFLECT_MERKLE_EVENTS(InviteSys);
      // clang-format on
   }  // namespace Invite

}  // namespace UserService
