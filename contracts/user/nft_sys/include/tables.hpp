#pragma once
#include <compare>
#include <psibase/AccountNumber.hpp>
#include <psibase/Bitset.hpp>
#include <psibase/table.hpp>

namespace UserContract
{
   using NID = uint32_t;

   struct NftHolderRecord
   {
      psibase::AccountNumber account;
      psibase::Bitset        config;

      operator psibase::AccountNumber() const { return account; }

      enum Flags : uint8_t
      {
         manualDebit
      };

      friend std::strong_ordering operator<=>(const NftHolderRecord&,
                                              const NftHolderRecord&) = default;
   };
   PSIO_REFLECT(NftHolderRecord, account, config);
   using NftHolderTable_t = psibase::table<NftHolderRecord, &NftHolderRecord::account>;

   struct NftRecord
   {
      NID                    id;
      psibase::AccountNumber issuer;
      psibase::AccountNumber owner;

      static bool isValidKey(const NID& id) { return id != 0; }

      friend std::strong_ordering operator<=>(const NftRecord&, const NftRecord&) = default;
   };
   PSIO_REFLECT(NftRecord, id, issuer, owner);
   using NftTable_t = psibase::table<NftRecord, &NftRecord::id>;

   // struct CreditTableKey_t
   // {
   //    psibase::AccountNumber creditor;
   //    NID                    nftId;

   //    friend std::strong_ordering operator<=>(const CreditTableKey_t&,
   //                                            const CreditTableKey_t&) = default;
   // };
   // PSIO_REFLECT(CreditTableKey_t, creditor, nftId);

   struct CreditRecord
   {
      NID                    nftId;
      psibase::AccountNumber debitor;

      friend std::strong_ordering operator<=>(const CreditRecord&, const CreditRecord&) = default;
   };
   PSIO_REFLECT(CreditRecord, nftId, debitor);
   using CreditTable_t = psibase::table<CreditRecord, &CreditRecord::nftId>;

}  // namespace UserContract