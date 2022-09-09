#pragma once

#include <compare>
#include <psibase/Service.hpp>
#include <psibase/Table.hpp>
#include <services/user/symbolErrors.hpp>
#include <services/user/symbolTables.hpp>
#include <string_view>

#include "services/user/tokenTypes.hpp"

namespace UserService
{
   class SymbolSys : public psibase::Service<SymbolSys>
   {
     public:
      using tables = psibase::
          ServiceTables<SymbolTable, SymbolLengthTable, PriceAdjustmentSingleton, InitTable>;
      static constexpr auto service        = psibase::AccountNumber("symbol-sys");
      static constexpr auto sysTokenSymbol = SID{"psi"};

      SymbolSys(psio::shared_view_ptr<psibase::Action> action);

      //void setAdjustRates(uint8_t increasePct, uint8_t decreasePct);
      //void configSymType(uint8_t symbolLength, Quantity startPrice, Quantity floorPrice, uint8_t targetCreatedPerDay);

      void init();

      void create(SID newSymbol, Quantity maxDebit);
      void listSymbol(SID symbol, Quantity price);
      void buySymbol(SID symbol);
      void unlistSymbol(SID symbol);

      SymbolRecord       getSymbol(SID symbol);
      bool               exists(SID symbol);
      Quantity           getPrice(size_t numChars);
      SymbolLengthRecord getSymbolType(size_t numChars);

      void updatePrices();

     private:
      tables db{psibase::getReceiver()};

     public:
      struct Events
      {
         using Account    = psibase::AccountNumber;
         using StringView = psio::const_view<psibase::String>;

         // clang-format off
         struct Ui  // History <-- Todo - Change back to History
         {
            void initialized() {}
            void symCreated(SID symbol, Account owner, Quantity cost) {}
            void symListed(SID symbol, Account seller, Quantity cost) {}
            void symSold(SID symbol, Account buyer, Account seller, Quantity cost) {}
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
      method(buySymbol, symbol),
      method(listSymbol, symbol, price),
      method(unlistSymbol, symbol),
      method(getSymbol, symbol),
      method(exists, symbol),
      method(getPrice, numChars),
      method(getSymbolType, numChars),
      method(updatePrices)
   );
   PSIBASE_REFLECT_UI_EVENTS(SymbolSys,
      method(initialized),
      method(symCreated, symbol, owner, cost),
      method(symListed, symbol, seller, cost),
      method(symSold, symbol, buyer, seller, cost),
      method(symUnlisted, symbol, owner)
   );
   // clang-format on

}  // namespace UserService
