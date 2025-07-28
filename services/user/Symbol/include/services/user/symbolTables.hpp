#pragma once
#include <algorithm>
#include <cctype>
#include <compare>
#include <psibase/AccountNumber.hpp>
#include <psibase/Table.hpp>
#include <psibase/time.hpp>
#include <string>

#include "services/user/Nft.hpp"
#include "services/user/tokenTypes.hpp"

namespace UserService
{
   using SID = psibase::AccountNumber;

   struct SymbolLengthRecord
   {
      uint8_t  symbol_length;
      uint16_t target_created_per_day;
      Quantity floor_price;
      Quantity active_price;

      uint16_t              create_counter;
      psibase::TimePointSec last_price_update_time;
   };
   PSIO_REFLECT(SymbolLengthRecord,
                symbol_length,
                target_created_per_day,
                floor_price,
                active_price,
                create_counter,
                last_price_update_time);
   using SymbolLengthTable = psibase::Table<SymbolLengthRecord, &SymbolLengthRecord::symbol_length>;
   PSIO_REFLECT_TYPENAME(SymbolLengthTable)

   struct PriceAdjustmentRecord
   {
      uint8_t key;
      uint8_t increasePct;
      uint8_t decreasePct;
   };
   PSIO_REFLECT(PriceAdjustmentRecord, key, increasePct, decreasePct);
   using PriceAdjustmentSingleton =
       psibase::Table<PriceAdjustmentRecord, &PriceAdjustmentRecord::key>;
   PSIO_REFLECT_TYPENAME(PriceAdjustmentSingleton)

   struct SaleDetails
   {
      Quantity               salePrice;  // 0 == NFS
      psibase::AccountNumber seller;

      friend std::strong_ordering operator<=>(const SaleDetails&, const SaleDetails&) = default;
   };
   PSIO_REFLECT(SaleDetails, salePrice, seller);

   struct SymbolRecord
   {
      SID symbolId;
      NID ownerNft;

      static bool isValidKey(SID testSymbol)
      {
         auto str = testSymbol.str();
         return std::all_of(str.begin(), str.end(), isalpha);
      }

      friend std::strong_ordering operator<=>(const SymbolRecord&, const SymbolRecord&) = default;
   };
   PSIO_REFLECT(SymbolRecord, symbolId, ownerNft);
   using SymbolTable = psibase::Table<SymbolRecord, &SymbolRecord::symbolId>;
   PSIO_REFLECT_TYPENAME(SymbolTable)
}  // namespace UserService
