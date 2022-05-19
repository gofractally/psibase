#pragma once
#include <algorithm>
#include <cctype>
#include <compare>
#include <psibase/AccountNumber.hpp>
#include <psibase/table.hpp>
#include <psibase/time.hpp>
#include <string>
#include "types.hpp"

#include "nft_sys.hpp"

namespace UserContract
{
   using SID = psibase::AccountNumber;

   struct SymbolLengthRecord
   {
      uint8_t  symbolLength;
      uint8_t  targetCreatedPerDay;
      Quantity startPrice;
      Quantity floorPrice;
      Quantity activePrice;

      uint8_t               createCounter;
      psibase::TimePointSec lastPriceUpdateTime;
   };
   PSIO_REFLECT(SymbolLengthRecord,
                symbolLength,
                targetCreatedPerDay,
                startPrice,
                floorPrice,
                activePrice,
                createCounter,
                lastPriceUpdateTime);
   using SymbolLengthTable_t =
       psibase::table<SymbolLengthRecord, &SymbolLengthRecord::symbolLength>;

   struct PriceAdjustmentRecord
   {
      uint8_t key;
      uint8_t increasePct;
      uint8_t decreasePct;
   };
   PSIO_REFLECT(PriceAdjustmentRecord, key, increasePct, decreasePct);
   using PriceAdjustmentSingleton_t =
       psibase::table<PriceAdjustmentRecord, &PriceAdjustmentRecord::key>;

   struct SymbolRecord
   {
      SID      symbolId;
      NID      ownerNft;
      Quantity salePrice;  // 0 == NFS

      static bool isValidKey(SID testSymbol)
      {
         auto allUpperAlpha = [](const std::string& str) {  //
            return std::all_of(str.begin(), str.end(), isupper) &&
                   std::all_of(str.begin(), str.end(), isalpha);
         };

         return allUpperAlpha(testSymbol.str());
      }

      friend std::strong_ordering operator<=>(const SymbolRecord&, const SymbolRecord&) = default;
   };
   PSIO_REFLECT(SymbolRecord, symbolId, ownerNft, salePrice);
   using SymbolTable_t = psibase::table<SymbolRecord, &SymbolRecord::symbolId>;

}  // namespace UserContract