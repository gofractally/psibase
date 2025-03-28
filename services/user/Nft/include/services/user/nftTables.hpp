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

      using Configurations = psibase::Enum<psibase::EnumElement{"manualDebit"}>;

      auto operator<=>(const NftHolderRecord&) const = default;
   };
   PSIO_REFLECT(NftHolderRecord, account, config);
   using NftHolderTable = psibase::Table<NftHolderRecord, &NftHolderRecord::account>;
   PSIO_REFLECT_TYPENAME(NftHolderTable)

   struct NftRecord
   {
      NID                    id;
      psibase::AccountNumber issuer;
      psibase::AccountNumber owner;

      static bool isValidKey(const NID& id) { return id != 0; }

      using ByOwner  = psibase::CompositeKey<&NftRecord::owner, &NftRecord::id>;
      using ByIssuer = psibase::CompositeKey<&NftRecord::issuer, &NftRecord::id>;

      auto operator<=>(const NftRecord&) const = default;
   };
   PSIO_REFLECT(NftRecord, id, issuer, owner);
   using NftTable =
       psibase::Table<NftRecord, &NftRecord::id, NftRecord::ByOwner{}, NftRecord::ByIssuer{}>;
   PSIO_REFLECT_TYPENAME(NftTable)

   struct CreditRecord
   {
      NID                    nftId;
      psibase::AccountNumber debitor;
      psibase::AccountNumber creditor;

      using ByCreditor = psibase::CompositeKey<&CreditRecord::creditor, &CreditRecord::nftId>;
      using ByDebitor  = psibase::CompositeKey<&CreditRecord::creditor, &CreditRecord::nftId>;

      auto operator<=>(const CreditRecord&) const = default;
   };
   PSIO_REFLECT(CreditRecord, nftId, debitor, creditor);
   using CreditTable = psibase::Table<CreditRecord,
                                      &CreditRecord::nftId,
                                      CreditRecord::ByCreditor{},
                                      CreditRecord::ByDebitor{}>;
   PSIO_REFLECT_TYPENAME(CreditTable)

}  // namespace UserService
