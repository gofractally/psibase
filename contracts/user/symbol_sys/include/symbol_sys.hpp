#pragma once

#include <compare>
#include <psibase/Contract.hpp>
#include <psibase/table.hpp>
#include <string_view>

#include "symbol_errors.hpp"
#include "symbol_tables.hpp"
#include "types.hpp"

/* 04/18/2022
 * James and Dan call notes:
 * Symbols are still handled by symbol table, 32 bit symbols, only uppercase, no numbers
 * Symbols are mapped to NIDs, which can be burned in the NFT contract, but the symbol table will always hold on to Symbol->NID mapping
 * Symbol IDs can be specified in a separate action on the token contract to permanently map the symbol to the token (burns underlying NFT)
 * 
*/

/* Boot notes:
 * NFT and token manualDebit flags should be set for the account holding this contract
 * The contract will use a default set of parameters for symbol pricing adjustment rates, floors, etc.
 *    Configure these settings if desired.
*/

namespace UserContract
{

   using tables = psibase::contract_tables<symbolTable_t>;
   class SymbolSys : public psibase::Contract<SymbolSys>
   {
     public:
      static constexpr auto contract = psibase::AccountNumber("symbol-sys");

      // Set the fee taken by the network on all symbol sales
      //void setNetworkFee(uint8_t salePct);
      //void setAdjustRates(uint8_t increasePct, uint8_t decreasePct);
      //void configSymType(uint8_t symbolLength, Quantity startPrice, Quantity floorPrice, uint8_t targetCreatedPerDay);

      void create(SID newSymbol, Quantity maxDebit);
      void buysymbol(SID symbol);
      void listSymbol(SID symbol, Quantity price);
      void unlistSymbol(SID symbol);

      SymbolRecord getSymbol(SID symbol);
      bool         exists(SID symbol);
      Quantity     getPrice(uint8_t numChars);

     private:
      tables db{contract};
   };

   // clang-format off
   PSIO_REFLECT(SymbolSys,
       method(create, newSymbol, maxDebit),
       method(buysymbol, symbol),
       method(listSymbol, symbol, price),
       method(unlistSymbol, symbol),
       method(getSymbol, symbol),
       method(exists, symbol),
       method(getPrice, numChars)
   );
   // clang-format on

}  // namespace UserContract
