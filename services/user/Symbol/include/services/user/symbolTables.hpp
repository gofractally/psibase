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
      uint8_t  symbolLength;
      uint8_t  targetCreatedPerDay;
      Quantity floorPrice;
      Quantity activePrice;

      uint8_t            createCounter;
      psibase::BlockTime lastPriceUpdateTime;
   };
   PSIO_REFLECT(SymbolLengthRecord,
                symbolLength,
                targetCreatedPerDay,
                floorPrice,
                activePrice,
                createCounter,
                lastPriceUpdateTime);
   using SymbolLengthTable = psibase::Table<SymbolLengthRecord, &SymbolLengthRecord::symbolLength>;
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
      SID         symbolId;
      NID         ownerNft;
      SaleDetails saleDetails;

      static bool isValidKey(SID testSymbol)
      {
         auto str = testSymbol.str();
         return std::all_of(str.begin(), str.end(), isalpha);
      }

      friend std::strong_ordering operator<=>(const SymbolRecord&, const SymbolRecord&) = default;
   };
   PSIO_REFLECT(SymbolRecord, symbolId, ownerNft, saleDetails);
   using SymbolTable = psibase::Table<SymbolRecord, &SymbolRecord::symbolId>;
   PSIO_REFLECT_TYPENAME(SymbolTable)
}  // namespace UserService
