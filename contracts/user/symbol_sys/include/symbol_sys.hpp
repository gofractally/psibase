#pragma once

#include <compare>
#include <psibase/Contract.hpp>
#include <psibase/table.hpp>
#include <string_view>

#include "symbol_errors.hpp"
#include "symbol_tables.hpp"
#include "types.hpp"

/* Boot notes:
 * NFT and token manualDebit flags should be set for the account holding this contract
 * The contract will use a default set of parameters for symbol pricing adjustment rates, floors, etc.
 *    Configure these settings if desired.
*/

namespace UserContract
{
   class SymbolSys : public psibase::Contract<SymbolSys>
   {
     public:
      using tables =
          psibase::contract_tables<SymbolTable_t, SymbolLengthTable_t, PriceAdjustmentSingleton_t>;
      static constexpr auto contract = psibase::AccountNumber("symbol-sys");

      //void setAdjustRates(uint8_t increasePct, uint8_t decreasePct);
      //void configSymType(uint8_t symbolLength, Quantity startPrice, Quantity floorPrice, uint8_t targetCreatedPerDay);

      // Initialize the contract
      void init();

      void create(SID newSymbol, Quantity maxDebit);
      void listSymbol(SID symbol, Quantity price);
      void buysymbol(SID symbol);
      void unlistSymbol(SID symbol);

      SymbolRecord getSymbol(SID symbol);
      bool         exists(SID symbol);
      Quantity     getPrice(size_t numChars);

     private:
      tables db{contract};

     public:
      struct Events
      {
         using Account    = psibase::AccountNumber;
         using StringView = psio::const_view<psibase::String>;

         // clang-format off
         struct Ui  // History <-- Todo - Change back to History
         {
            void symCreated(SID symbol, Account owner, Quantity cost) {}
            void symListed(SID symbol, Account seller, Quantity cost) {}
            void symBought(SID symbol, Account buyer, Account seller, Quantity cost) {}
            void symUnlisted(SID symbol, Account owner) {}
            //};

            //struct Ui{};

            //struct Merkle{};
         };
      };
      // clang-format on
   };

   // clang-format off
   PSIO_REFLECT(SymbolSys,
      method(init),
      method(create, newSymbol, maxDebit),
      method(buysymbol, symbol),
      method(listSymbol, symbol, price),
      method(unlistSymbol, symbol),
      method(getSymbol, symbol),
      method(exists, symbol),
      method(getPrice, numChars)
   );
   PSIBASE_REFLECT_UI_EVENTS(SymbolSys,
      method(symCreated, symbol, owner, cost),
      method(symListed, symbol, seller, cost),
      method(symBought, symbol, buyer, Account seller, cost),
      method(symUnlisted, symbol, owner)
   );
   // clang-format on

}  // namespace UserContract
