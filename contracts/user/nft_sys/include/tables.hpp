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
      psibase::AccountNumber creditedTo;

      static bool isValidKey(const NID& id) { return id != 0; }

      friend std::strong_ordering operator<=>(const NftRecord&, const NftRecord&) = default;
   };
   PSIO_REFLECT(NftRecord, id, issuer, owner, creditedTo);
   // Todo: Also index by issuer and owner when additional indices are possible
   using NftTable_t = psibase::table<NftRecord, &NftRecord::id>;

   // Todo: separate creditedTo into its own table

}  // namespace UserContract