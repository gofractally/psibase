#pragma once

#include <psibase/Table.hpp>
//#include <psio/reflect.hpp>

namespace UserService
{
   namespace Invite
   {
      struct ServiceEventRecord
      {
         psibase::SingletonKey key;
         uint64_t              eventHead;
      };
      PSIO_REFLECT(ServiceEventRecord, key, eventHead);
      using ServiceEventTable = psibase::Table<ServiceEventRecord, &ServiceEventRecord::key>;

      struct InviteSettingsRecord
      {
         psibase::SingletonKey               key;
         std::vector<psibase::AccountNumber> whitelist;
         std::vector<psibase::AccountNumber> blacklist;
      };
      PSIO_REFLECT(InviteSettingsRecord, key, whitelist, blacklist);
      using InviteSettingsTable = psibase::Table<InviteSettingsRecord, &InviteSettingsRecord::key>;

      struct UserEventRecord
      {
         psibase::AccountNumber user;
         uint64_t               eventHead;
      };
      PSIO_REFLECT(UserEventRecord, user, eventHead);
      using UserEventTable = psibase::Table<UserEventRecord, &UserEventRecord::user>;

      struct InviteRecord
      {
         psibase::PublicKey     pubkey;
         psibase::AccountNumber inviter;
         psibase::AccountNumber acceptedBy;
         uint32_t               expiry;
         bool                   newAccountToken = false;
      };
      PSIO_REFLECT(InviteRecord, pubkey, inviter, acceptedBy, expiry, newAccountToken);
      using InviteTable =
          psibase::Table<InviteRecord, &InviteRecord::pubkey, &InviteRecord::inviter>;

   }  // namespace Invite
}  // namespace UserService
