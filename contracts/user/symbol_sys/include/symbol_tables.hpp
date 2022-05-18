#pragma once
#include <compare>
#include <psibase/AccountNumber.hpp>
#include <psibase/table.hpp>
#include "types.hpp"

#include "nft_sys.hpp"

namespace UserContract
{
   using SID = psibase::AccountNumber;

   struct SymbolRecord
   {
      SID      symbolId;
      NID      ownerNft;
      Quantity salePrice;

      friend std::strong_ordering operator<=>(const SymbolRecord&, const SymbolRecord&) = default;
   };
   PSIO_REFLECT(SymbolRecord, symbolId, ownerNft);

   using symbolTable_t = psibase::table<SymbolRecord, &SymbolRecord::symbolId>;

}  // namespace UserContract