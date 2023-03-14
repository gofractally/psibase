#pragma once

#include <psibase/psibase.hpp>
#include <services/system/CommonTables.hpp>
#include <services/user/fractalErrors.hpp>
#include <services/user/fractalTables.hpp>

namespace UserService
{
   namespace Fractal
   {
      class FractalSys : public psibase::Service<FractalSys>
      {
        public:
         using Tables = psibase::ServiceTables<InitTable,
                                               psibase::WebContentTable,
                                               FractalTable,
                                               FractalTypeTable,
                                               MemberTable,
                                               InviteTable,
                                               IdentityTable,
                                               ServiceEventTable>;

         static constexpr auto service = psibase::AccountNumber("fractal-sys");

         FractalSys(psio::shared_view_ptr<psibase::Action> action);

         void init();

         /// todo
         void createIdentity();

         /// todo
         void setDispName(std::string displayName);

         /// todo
         void invite(psibase::AccountNumber fractal, psibase::PublicKey pubkey);

         /// Allows a user to claim ownership of an invite.
         ///
         /// This uses the invite-sys system service to get proof that the claimant is
         /// the true recipient of the invite.
         ///
         /// A user may claim more than one invite without accepting or rejecting them.
         void claim(psibase::PublicKey inviteKey);

         /// todo
         void accept(psibase::PublicKey inviteKey);

         /// todo
         void reject(psibase::PublicKey inviteKey);

         // todo - a pump to delete expired invites

         /// todo
         void registerType();

         /// todo
         void newFractal(psibase::AccountNumber name,
                         psibase::AccountNumber type,
                         std::string            prettyName);

         auto serveSys(psibase::HttpRequest request) -> std::optional<psibase::HttpReply>;
         void storeSys(std::string path, std::string contentType, std::vector<char> content);

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
      PSIO_REFLECT(FractalSys,
         method(init),

         method(createIdentity),
         method(setDispName, displayName),

         method(invite, fractal, pubkey),
         method(claim, inviteKey),
         method(accept, inviteKey),
         method(reject, inviteKey),

         method(registerType),
         method(newFractal, name, type, prettyName),

         method(serveSys, request),
         method(storeSys, path, contentType, content),

         // Interface for other services
         method(getIdentity, name),
         method(getMember, account, fractal)
      );
      PSIBASE_REFLECT_EVENTS(FractalSys);
      PSIBASE_REFLECT_HISTORY_EVENTS(FractalSys,
         method(identityAdded, prevEvent, name),
         method(invCreated, prevEvent, creator, fractal),
         method(invReceived, prevEvent, receiver, fractal),
         method(invAccepted, prevEvent, accepter, fractal),
         method(invRejected, prevEvent, rejecter, fractal),
         method(joinedFrac, prevEvent, fractal)
      );
      PSIBASE_REFLECT_UI_EVENTS(FractalSys);
      PSIBASE_REFLECT_MERKLE_EVENTS(FractalSys);
      // clang-format on

   }  // namespace Fractal

}  // namespace UserService
