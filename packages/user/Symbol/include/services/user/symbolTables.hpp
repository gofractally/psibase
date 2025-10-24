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
      uint64_t  nftId;
   };
   PSIO_REFLECT(SymbolLengthRecord,
                symbolLength,
                nftId);
   using SymbolLengthTable = psibase::Table<SymbolLengthRecord, &SymbolLengthRecord::symbolLength>;
   PSIO_REFLECT_TYPENAME(SymbolLengthTable)

   struct SymbolRecord
   {
      SID         symbolId;
      NID         ownerNft;

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
