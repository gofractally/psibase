#pragma once
#include <compare>
#include <psibase/AccountNumber.hpp>
#include <psibase/Bitset.hpp>
#include <psibase/Table.hpp>

namespace UserContract
{
   using NID = uint32_t;

   // This structure is shared between several User contracts that need a
   //   flag to track initialization
   struct SingletonKey
   {
   };
   PSIO_REFLECT(SingletonKey);
   struct InitializedRecord
   {
      SingletonKey key;
   };
   PSIO_REFLECT(InitializedRecord, key);
   using InitTable_t = psibase::Table<InitializedRecord, &InitializedRecord::key>;

   struct NftHolderRecord
   {
      psibase::AccountNumber account;
      psibase::Bitset<8>     config;

      using Configurations = psibase::NamedBits<psibase::NamedBit_t{"manualDebit"}>;

      auto operator<=>(const NftHolderRecord&) const = default;
   };
   PSIO_REFLECT(NftHolderRecord, account, config);
   using NftHolderTable_t = psibase::Table<NftHolderRecord, &NftHolderRecord::account>;

   struct NftRecord
   {
      NID                    id;
      psibase::AccountNumber issuer;
      psibase::AccountNumber owner;

      static bool isValidKey(const NID& id) { return id != 0; }

      auto operator<=>(const NftRecord&) const = default;
   };
   PSIO_REFLECT(NftRecord, id, issuer, owner);
   using NftTable_t = psibase::Table<NftRecord, &NftRecord::id>;

   struct CreditRecord
   {
      NID                    nftId;
      psibase::AccountNumber debitor;

      auto operator<=>(const CreditRecord&) const = default;
   };
   PSIO_REFLECT(CreditRecord, nftId, debitor);
   using CreditTable_t = psibase::Table<CreditRecord, &CreditRecord::nftId>;

}  // namespace UserContract