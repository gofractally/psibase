#pragma once
#include <compare>
#include <cstdint>
#include <psibase/AccountNumber.hpp>
#include <psibase/Bitset.hpp>
#include <psibase/Table.hpp>

namespace UserService
{
   using NID = uint32_t;

   struct NftConfigRow
   {
      NID next_id;
   };
   PSIO_REFLECT(NftConfigRow, next_id)
   using NftConfigTable = psibase::Table<NftConfigRow, psibase::SingletonKey{}>;
   PSIO_REFLECT_TYPENAME(NftConfigTable)

   struct NftHolderRecord
   {
      psibase::AccountNumber account;
      uint8_t                config;

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
      psibase::AccountNumber creditor;
      psibase::AccountNumber debitor;

      using ByCreditor = psibase::CompositeKey<&CreditRecord::creditor, &CreditRecord::nftId>;
      using ByDebitor  = psibase::CompositeKey<&CreditRecord::debitor, &CreditRecord::nftId>;

      auto operator<=>(const CreditRecord&) const = default;
   };
   PSIO_REFLECT(CreditRecord, nftId, creditor, debitor);
   using CreditTable = psibase::Table<CreditRecord,
                                      &CreditRecord::nftId,
                                      CreditRecord::ByCreditor{},
                                      CreditRecord::ByDebitor{}>;
   PSIO_REFLECT_TYPENAME(CreditTable)

}  // namespace UserService
