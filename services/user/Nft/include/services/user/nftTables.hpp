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

   struct NftRecord
   {
      NID                    id;
      psibase::AccountNumber issuer;
      psibase::AccountNumber owner;

      static bool isValidKey(const NID& id) { return id != 0; }

      auto byOwner() const { return std::tuple{owner, id}; }
      auto byIssuer() const { return std::tuple{issuer, id}; }

      auto operator<=>(const NftRecord&) const = default;
   };
   PSIO_REFLECT(NftRecord, id, issuer, owner);
   using NftTable =
       psibase::Table<NftRecord, &NftRecord::id, &NftRecord::byOwner, &NftRecord::byIssuer>;

   struct CreditRecord
   {
      NID                    nftId;
      psibase::AccountNumber debitor;
      psibase::AccountNumber creditor;

      auto byCreditor() const { return std::tuple{creditor, nftId}; }
      auto byDebitor() const { return std::tuple{debitor, nftId}; }

      auto operator<=>(const CreditRecord&) const = default;
   };
   PSIO_REFLECT(CreditRecord, nftId, debitor, creditor);
   using CreditTable = psibase::Table<CreditRecord,
                                      &CreditRecord::nftId,
                                      &CreditRecord::byCreditor,
                                      &CreditRecord::byDebitor>;

}  // namespace UserService