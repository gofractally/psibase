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
      };
      PSIO_REFLECT(NextInviteId, nextInviteId);
      using NextInviteIdTable = psibase::Table<NextInviteId, psibase::SingletonKey{}>;
      PSIO_REFLECT_TYPENAME(NextInviteIdTable)

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

         using ByInviter = psibase::CompositeKey<&InviteRecord::inviter, &InviteRecord::inviteId>;
         using ById2 = psibase::CompositeKey<&InviteRecord::secondaryId, &InviteRecord::inviteId>;
         using ByPubkey =
             psibase::CompositeKey<psibase::NestedKey<&InviteRecord::pubkey, &Spki::fingerprint>{},
                                   &InviteRecord::inviteId>;
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
                                         InviteRecord::ByInviter{},
                                         InviteRecord::ById2{},
                                         InviteRecord::ByPubkey{}>;
      PSIO_REFLECT_TYPENAME(InviteTable)

      struct NewAccountRecord
      {
         psibase::AccountNumber name;
         psibase::AccountNumber inviter;
      };
      PSIO_REFLECT(NewAccountRecord, name, inviter);
      using NewAccTable = psibase::Table<NewAccountRecord, &NewAccountRecord::name>;
      PSIO_REFLECT_TYPENAME(NewAccTable)

   }  // namespace InviteNs
}  // namespace UserService
