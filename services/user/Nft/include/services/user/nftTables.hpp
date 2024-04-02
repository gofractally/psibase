#pragma once
#include <compare>
#include <psibase/AccountNumber.hpp>
#include <psibase/Bitset.hpp>
#include <psibase/Table.hpp>

namespace UserService
{
   using NID = uint32_t;

   struct NftHolderRecord
   {
      psibase::AccountNumber account;
      psibase::Bitset<8>     config;

      uint64_t eventHead;

      using Configurations = psibase::Enum<psibase::EnumElement{"manualDebit"}>;

      auto operator<=>(const NftHolderRecord&) const = default;
   };
   PSIO_REFLECT(NftHolderRecord, account, config, eventHead);
   using NftHolderTable = psibase::Table<NftHolderRecord, &NftHolderRecord::account>;

   struct NftRecord
   {
      NID                    id;
      psibase::AccountNumber issuer;
      psibase::AccountNumber owner;

      uint64_t eventHead;

      static bool isValidKey(const NID& id) { return id != 0; }

      auto operator<=>(const NftRecord&) const = default;
   };
   PSIO_REFLECT(NftRecord, id, issuer, owner, eventHead);
   using NftTable = psibase::Table<NftRecord, &NftRecord::id>;

   struct CreditRecord
   {
      NID                    nftId;
      psibase::AccountNumber debitor;

      auto operator<=>(const CreditRecord&) const = default;
   };
   PSIO_REFLECT(CreditRecord, nftId, debitor);
   using CreditTable = psibase::Table<CreditRecord, &CreditRecord::nftId>;

}  // namespace UserService
