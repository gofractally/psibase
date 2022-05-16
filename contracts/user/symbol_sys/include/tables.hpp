#pragma once
#include <compare>
#include <psibase/AccountNumber.hpp>
#include <psibase/table.hpp>

#include "nft_sys.hpp"

namespace UserContract
{
   using SID    = uint32_t;
   using Ticker = psibase::AccountNumber;

   struct SymbolRecord
   {
      SID    symbolId;
      NID    ownerNft;
      Ticker ticker;

      friend std::strong_ordering operator<=>(const SymbolRecord&, const SymbolRecord&) = default;
   };
   PSIO_REFLECT(SymbolRecord, symbolId, ticker);

   using symbolTable_t = psibase::table<SymbolRecord, &SymbolRecord::symbolId>;

}  // namespace UserContract