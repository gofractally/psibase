#pragma once

#include <psibase/Table.hpp>
#include <services/system/AuthSig.hpp>

namespace UserService
{
   namespace InviteNs
   {
      using Spki = SystemService::AuthSig::SubjectPublicKeyInfo;

      struct ServiceEventRecord
      {
         psibase::SingletonKey key;
         uint64_t              eventHead;
      };
      PSIO_REFLECT(ServiceEventRecord, key, eventHead);
      using ServiceEventTable = psibase::Table<ServiceEventRecord, &ServiceEventRecord::key>;

      struct UserEventRecord
      {
         psibase::AccountNumber user;
         uint64_t               eventHead;
      };
      PSIO_REFLECT(UserEventRecord, user, eventHead);
      using UserEventTable = psibase::Table<UserEventRecord, &UserEventRecord::user>;

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

      /// Table to track the contents of an invite
      ///
      /// - `pubkey`: The public key of the invite. This uniquely identifies
      /// an invite and is also used to authenticate transactions by users without
      /// an existing Psibase account.
      /// - `inviter`: The creator of the invite object
      /// - `actor`: The last account to accept or reject the invite
      /// - `expiry`: The time in seconds at which this invite expires
      /// - `newAccountToken`: A flag that represents whether a new account may
      /// still be created by redeeming this invite
      /// - `state`: An integer representing whether the invite is pending (0),
      /// accepted (1), or rejected (2)
      struct InviteRecord
      {
         Spki                   pubkey;
         psibase::AccountNumber inviter;
         psibase::AccountNumber actor;
         uint32_t               expiry;
         bool                   newAccountToken = false;
         uint8_t                state;

         auto secondary() const { return std::tie(inviter, pubkey); }
      };
      PSIO_REFLECT(InviteRecord, pubkey, inviter, actor, expiry, newAccountToken, state);
      using InviteTable =
          psibase::Table<InviteRecord, &InviteRecord::pubkey, &InviteRecord::secondary>;

      struct NewAccountRecord
      {
         psibase::AccountNumber name;
         psibase::AccountNumber invitee;
      };
      PSIO_REFLECT(NewAccountRecord, name, invitee);
      using NewAccTable = psibase::Table<NewAccountRecord, &NewAccountRecord::name>;

   }  // namespace InviteNs
}  // namespace UserService
