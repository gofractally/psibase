#pragma once

#include <psibase/Table.hpp>
#include <services/system/AuthSig.hpp>

namespace UserService
{
   namespace InviteNs
   {
      using Spki = SystemService::AuthSig::SubjectPublicKeyInfo;

      /// Table to track the contents of the invite creation
      /// whitelist and blacklist
      struct InviteSettingsRecord
      {
         psibase::SingletonKey               key;
         std::vector<psibase::AccountNumber> whitelist;
         std::vector<psibase::AccountNumber> blacklist;
      };
      PSIO_REFLECT(InviteSettingsRecord, key, whitelist, blacklist);
      using InviteSettingsTable = psibase::Table<InviteSettingsRecord, &InviteSettingsRecord::key>;

      enum InviteStates
      {
         pending = 0,
         accepted,
         rejected
      };

      /// An invite object
      struct InviteRecord
      {
         /// The public key of the invite. This uniquely identifies an invite and
         ///   may also used to authenticate the transaction accepting the invite.
         Spki pubkey;

         /// The creator of the invite object
         psibase::AccountNumber inviter;

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

         auto secondary() const { return std::tie(inviter, pubkey); }
      };
      PSIO_REFLECT(InviteRecord, pubkey, inviter, actor, expiry, newAccountToken, state);
      using InviteTable =
          psibase::Table<InviteRecord, &InviteRecord::pubkey, &InviteRecord::secondary>;

      struct NewAccountRecord
      {
         psibase::AccountNumber name;
         psibase::AccountNumber inviter;
      };
      PSIO_REFLECT(NewAccountRecord, name, inviter);
      using NewAccTable = psibase::Table<NewAccountRecord, &NewAccountRecord::name>;

   }  // namespace InviteNs
}  // namespace UserService
