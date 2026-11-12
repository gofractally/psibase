#pragma once

#include <psibase/Table.hpp>
#include <services/system/AuthSig.hpp>
#include <services/user/tokenTypes.hpp>

namespace UserService
{
   namespace InviteNs
   {
      using Spki = SystemService::AuthSig::SubjectPublicKeyInfo;

      struct InviteEventType
      {
         static constexpr std::string_view created        = "created";
         static constexpr std::string_view accepted       = "accepted";
         static constexpr std::string_view accountRedeemed = "accountRedeemed";
         static constexpr std::string_view deleted        = "deleted";
      };

      /// An invite object
      struct InviteRecord
      {
         /// The id of the invite (not sequential)
         uint32_t id;

         /// The id of the credential associated with the invite
         uint32_t cid;

         /// The creator of the invite object
         psibase::AccountNumber inviter;

         /// Represents the number of accounts this invite can be used to create
         uint16_t numAccounts;

         /// A flag that represents whether to use hooks to notify the inviter when the invite is updated
         bool useHooks;

         /// The encrypted secret used to redeem the invite
         std::string secret;

         /// Per-account vserver resource subsidy reserved for each redeemed account
         Quantity subsidy;

         using ByInviter = psibase::CompositeKey<&InviteRecord::inviter, &InviteRecord::id>;
      };
      PSIO_REFLECT(InviteRecord, id, cid, inviter, numAccounts, useHooks, secret, subsidy);
      using InviteTable = psibase::
          Table<InviteRecord, &InviteRecord::id, InviteRecord::ByInviter{}, &InviteRecord::cid>;
      PSIO_REFLECT_TYPENAME(InviteTable)

      struct RedeemedAccountRecord
      {
         uint32_t               inviteId;
         psibase::AccountNumber account;
      };
      PSIO_REFLECT(RedeemedAccountRecord, inviteId, account);
      using RedeemedAccountTable =
          psibase::Table<RedeemedAccountRecord,
                         &RedeemedAccountRecord::inviteId,
                         &RedeemedAccountRecord::account>;
      PSIO_REFLECT_TYPENAME(RedeemedAccountTable)

   }  // namespace InviteNs
}  // namespace UserService
