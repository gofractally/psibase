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

      uint8_t                createCounter;
      psibase::TimePointUSec lastPriceUpdateTime;

      uint64_t eventHead;
   };
   PSIO_REFLECT(SymbolLengthRecord,
                symbolLength,
                targetCreatedPerDay,
                floorPrice,
                activePrice,
                createCounter,
                lastPriceUpdateTime);
   using SymbolLengthTable = psibase::Table<SymbolLengthRecord, &SymbolLengthRecord::symbolLength>;

   struct PriceAdjustmentRecord
   {
      uint8_t key;
      uint8_t increasePct;
      uint8_t decreasePct;
   };
   PSIO_REFLECT(PriceAdjustmentRecord, key, increasePct, decreasePct);
   using PriceAdjustmentSingleton =
       psibase::Table<PriceAdjustmentRecord, &PriceAdjustmentRecord::key>;

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

      uint64_t eventHead = 0;

      static bool isValidKey(SID testSymbol)
      {
         auto str = testSymbol.str();
         return std::all_of(str.begin(), str.end(), isalpha);
      }

      friend std::strong_ordering operator<=>(const SymbolRecord&, const SymbolRecord&) = default;
   };
   PSIO_REFLECT(SymbolRecord, symbolId, ownerNft, saleDetails, eventHead);
   using SymbolTable = psibase::Table<SymbolRecord, &SymbolRecord::symbolId>;

   struct UserSymbolEventsRecord
   {
      psibase::AccountNumber account;
      uint64_t               eventHead = 0;
   };
   PSIO_REFLECT(UserSymbolEventsRecord, account, eventHead);
   using UserEventTable = psibase::Table<UserSymbolEventsRecord, &UserSymbolEventsRecord::account>;
}  // namespace UserService
