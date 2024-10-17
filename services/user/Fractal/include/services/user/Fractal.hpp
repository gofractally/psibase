#pragma once

#include <psibase/psibase.hpp>
#include <services/system/CommonTables.hpp>
#include <services/user/fractalErrors.hpp>
#include <services/user/fractalTables.hpp>

namespace UserService
{
   namespace FractalNs
   {
      class Fractal : public psibase::Service
      {
        public:
         using Tables = psibase::ServiceTables<InitTable,
                                               FractalTable,
                                               FractalTypeTable,
                                               MemberTable,
                                               InviteTable,
                                               IdentityTable,
                                               ServiceEventTable>;

         static constexpr auto service = psibase::AccountNumber("fractal");

         Fractal(psio::shared_view_ptr<psibase::Action> action);

         void init();

         /// todo
         void createIdentity();

         /// todo
         void setDispName(std::string displayName);

         /// todo
         void invite(psibase::AccountNumber fractal, PublicKey pubkey);

         /// Allows a user to claim ownership of an invite.
         ///
         /// This uses the invite system service to get proof that the claimant is
         /// the true recipient of the invite.
         ///
         /// A user may claim more than one invite without accepting or rejecting them.
         void claim(PublicKey inviteKey);

         /// todo
         void accept(PublicKey inviteKey);

         /// todo
         void reject(PublicKey inviteKey);

         // todo - a pump to delete expired invites

         /// todo
         void registerType();

         /// todo
         void newFractal(psibase::AccountNumber fractalAccount, psibase::AccountNumber type);
         void setFracName(psibase::AccountNumber fractalAccount, std::string displayName);
         void setFracDesc(psibase::AccountNumber fractalAccount, std::string description);
         void setFracLang(psibase::AccountNumber fractalAccount, std::string languageCode);

         auto serveSys(psibase::HttpRequest request) -> std::optional<psibase::HttpReply>;

         // clang-format off
         struct Events
         {
            struct History{
               void identityAdded(uint64_t prevEvent, psibase::AccountNumber name);
               void invCreated(uint64_t prevEvent, psibase::AccountNumber creator, psibase::AccountNumber fractal);
               void invReceived(uint64_t prevEvent, psibase::AccountNumber receiver, psibase::AccountNumber fractal);
               void invAccepted(uint64_t prevEvent, psibase::AccountNumber accepter, psibase::AccountNumber fractal);
               void invRejected(uint64_t prevEvent, psibase::AccountNumber rejecter, psibase::AccountNumber fractal);

               // Not used yet
               void joinedFrac(uint64_t prevEvent, psibase::AccountNumber fractal);
            };
            struct Ui{};
            struct Merkle{};
         };
         using ServiceEvents = psibase::EventIndex<&ServiceEventRecord::eventHead, "prevEvent">;
         using FractalEvents = psibase::EventIndex<&FractalRecord::eventHead, "prevEvent">;
         using UserEvents = psibase::EventIndex<&IdentityRecord::eventHead, "prevEvent">;
         // clang-format on

         // Interface for other services
         std::optional<IdentityRecord>   getIdentity(psibase::AccountNumber name);
         std::optional<MembershipRecord> getMember(psibase::AccountNumber account,
                                                   psibase::AccountNumber fractal);

        private:
         void newIdentity(psibase::AccountNumber name, bool requireNew);
      };

      // clang-format off
      PSIO_REFLECT(Fractal,
         method(init),

         method(createIdentity),
         method(setDispName, displayName),

         method(invite, fractal, pubkey),
         method(claim, inviteKey),
         method(accept, inviteKey),
         method(reject, inviteKey),

         method(registerType),
         method(newFractal, name, type),
         method(setFracName, fractalAccount, displayName),
         method(setFracDesc, fractalAccount, description),
         method(setFracLang, fractalAccount, languageCode),

         method(serveSys, request),

         // Interface for other services
         method(getIdentity, name),
         method(getMember, account, fractal)
      );
      PSIBASE_REFLECT_EVENTS(Fractal);
      PSIBASE_REFLECT_HISTORY_EVENTS(Fractal,
         method(identityAdded, prevEvent, name),
         method(invCreated, prevEvent, creator, fractal),
         method(invReceived, prevEvent, receiver, fractal),
         method(invAccepted, prevEvent, accepter, fractal),
         method(invRejected, prevEvent, rejecter, fractal),
         method(joinedFrac, prevEvent, fractal)
      );
      PSIBASE_REFLECT_UI_EVENTS(Fractal);
      PSIBASE_REFLECT_MERKLE_EVENTS(Fractal);
      // clang-format on

   }  // namespace FractalNs

}  // namespace UserService
