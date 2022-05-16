#pragma once

#include <compare>
#include <psibase/Contract.hpp>
#include <psibase/table.hpp>
#include <string_view>

#include "errors.hpp"
#include "tables.hpp"
#include "types.hpp"

/* 04/18/2022
 * James and Dan call notes:
 * Symbols are still handled by symbol table, 32 bit symbols, only uppercase, no numbers
 * Symbols are mapped to NIDs, which can be burned in the NFT contract, but the symbol table will always hold on to Symbol->NID mapping
 * Symbol IDs can be specified in a separate action on the token contract to permanently map the symbol to the token (burns underlying NFT)
 * 
*/

namespace UserContract
{

   using tables = psibase::contract_tables<symbolTable_t>;
   class SymbolSys : public psibase::Contract<SymbolSys>
   {
     public:
      static constexpr auto contract = psibase::AccountNumber("symbol-sys");

      SID  purchase(Ticker newSymbol, Quantity maxCost);
      void buysymbol(psibase::AccountNumber buyer, std::string symbol);
      void sellsymbol(std::string symbol, int64_t price);
      void withdraw(psibase::AccountNumber owner, int64_t amount);
      void setsalefee(uint32_t fee);
      void setsym(uint32_t symlen,
                  int64_t  price,
                  int64_t  floor,
                  uint32_t increase_thresold,
                  uint32_t decrease_threshold,
                  uint32_t window);
      void setowner(psibase::AccountNumber owner, std::string sym, std::string memo);

      SymbolRecord getSymbol(SID symbolId);
      Quantity     getPrice(uint8_t numChars);

     private:
      tables db{contract};
   };

   // clang-format off
   PSIO_REFLECT(SymbolSys,
       method(purchase, newSymbol, maxCost),
       method(getSymbol, symbolId),
       method(getPrice, numChars)
   );
   // clang-format on

}  // namespace UserContract
