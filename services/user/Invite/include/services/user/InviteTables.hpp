#pragma once

#include <psibase/Table.hpp>
#include <services/system/AuthSig.hpp>

namespace UserService
{
   namespace InviteNs
   {
      using Spki = SystemService::AuthSig::SubjectPublicKeyInfo;

      enum InviteStates : uint8_t
      {
         pending = 0,
         accepted,
         rejected
      };

      struct InviteEventType
      {
         static constexpr std::string_view created        = "created";
         static constexpr std::string_view accepted       = "accepted";
         static constexpr std::string_view rejected       = "rejected";
         static constexpr std::string_view deleted        = "deleted";
         static constexpr std::string_view deletedExpired = "deletedExpired";
      };

      struct NextInviteId
      {
         uint32_t nextInviteId;

         auto primary() const { return psibase::SingletonKey{}; }
      };
      PSIO_REFLECT(NextInviteId, nextInviteId);
      using NextInviteIdTable = psibase::Table<NextInviteId, &NextInviteId::primary>;

      /// An invite object
      struct InviteRecord
      {
         /// Monotonically increasing ID of the invite
         uint32_t inviteId;

         /// The public key of the invite. This uniquely identifies an invite and
         ///   may also used to authenticate the transaction accepting the invite.
         Spki pubkey;

         /// An optional secondary identifier for the invite
         std::optional<uint32_t> secondaryId;

         /// The creator of the invite object
         psibase::AccountNumber inviter;

         /// The app responsible for creating the invite
         std::optional<psibase::AccountNumber> app;

         /// The domain of the app responsible for creating the invite
         std::optional<std::string> appDomain;

         /// The last account to accept or reject the invite
         psibase::AccountNumber actor;

         /// The time in seconds at which this invite expires
         psibase::TimePointSec expiry;

         /// A flag that represents whether a new account may still be created by
         ///   redeeming this invite
         bool newAccountToken = false;

         /// An integer representing whether the invite is:
         ///  - pending (0)
         ///  - accepted (1)
         ///  - rejected (2)
         uint8_t state;

         /// Encrypted invite secret
         std::optional<std::string> secret;

         auto byInviter() const { return std::tie(inviter, inviteId); }
         auto byId2() const { return std::tie(secondaryId, inviteId); }
         auto byPubkey() const
         {
            return std::tuple{SystemService::AuthSig::keyFingerprint(pubkey), inviteId};
         }
      };
      PSIO_REFLECT(InviteRecord,
                   inviteId,
                   pubkey,
                   secondaryId,
                   inviter,
                   app,
                   appDomain,
                   actor,
                   expiry,
                   newAccountToken,
                   state,
                   secret);
      using InviteTable = psibase::Table<InviteRecord,
                                         &InviteRecord::inviteId,
                                         &InviteRecord::byInviter,
                                         &InviteRecord::byId2,
                                         &InviteRecord::byPubkey>;

      struct NewAccountRecord
      {
         psibase::AccountNumber name;
         psibase::AccountNumber inviter;
      };
      PSIO_REFLECT(NewAccountRecord, name, inviter);
      using NewAccTable = psibase::Table<NewAccountRecord, &NewAccountRecord::name>;

   }  // namespace InviteNs
}  // namespace UserService
