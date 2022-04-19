#pragma once
#include <compare>
#include <psibase/AccountNumber.hpp>
#include <psibase/table.hpp>

namespace UserContract
{
   using NID = uint32_t;

   struct AutodebitRecord
   {
      psibase::AccountNumber user;
      bool                   autodebit;

      friend std::strong_ordering operator<=>(const AutodebitRecord&,
                                              const AutodebitRecord&) = default;
   };
   EOSIO_REFLECT(AutodebitRecord, user, autodebit);
   PSIO_REFLECT(AutodebitRecord, user, autodebit);
   using AdTable_t = psibase::table<AutodebitRecord, &AutodebitRecord::user>;

   struct NftRecord
   {
      NID                    id;
      psibase::AccountNumber issuer;
      psibase::AccountNumber owner;
      psibase::AccountNumber creditedTo;

      static bool isValidKey(const NID& id) { return id != 0; }

      friend std::strong_ordering operator<=>(const NftRecord&, const NftRecord&) = default;
   };
   EOSIO_REFLECT(NftRecord, id, issuer, owner, creditedTo);
   PSIO_REFLECT(NftRecord, id, issuer, owner, creditedTo);
   // Todo: Also index by issuer and owner when additional indices are possible
   using NftTable_t = psibase::table<NftRecord, &NftRecord::id>;

   // Todo: separate creditedTo into its own table

}  // namespace UserContract