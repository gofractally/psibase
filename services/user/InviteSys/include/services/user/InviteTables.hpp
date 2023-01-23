#pragma once

#include <psibase/Table.hpp>

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

      enum InviteStates
      {
         pending = 0,
         accepted,
         rejected
      };

      struct InviteRecord
      {
         psibase::PublicKey     pubkey;
         psibase::AccountNumber inviter;
         psibase::AccountNumber actor;
         uint32_t               expiry;
         bool                   newAccountToken = false;
         uint8_t                state;

         auto secondary() const { return std::tie(inviter, pubkey); }
      };
      PSIO_REFLECT(InviteRecord,
                   pubkey,
                   inviter,
                   actor,
                   expiry,
                   newAccountToken,
                   state,
                   method(secondary));
      using InviteTable =
          psibase::Table<InviteRecord, &InviteRecord::pubkey, &InviteRecord::secondary>;

   }  // namespace Invite
}  // namespace UserService
