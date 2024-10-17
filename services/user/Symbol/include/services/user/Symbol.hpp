#pragma once

#include <psibase/psibase.hpp>

#include <services/system/CommonTables.hpp>
#include <services/user/symbolErrors.hpp>
#include <services/user/symbolTables.hpp>
#include <services/user/tokenTypes.hpp>

namespace UserService
{
   class Symbol : public psibase::Service
   {
     public:
      using Tables = psibase::ServiceTables<SymbolTable,
                                            SymbolLengthTable,
                                            PriceAdjustmentSingleton,
                                            InitTable,
                                            UserEventTable>;

      static constexpr auto service        = psibase::AccountNumber("symbol");
      static constexpr auto sysTokenSymbol = SID{"psi"};

      Symbol(psio::shared_view_ptr<psibase::Action> action);

      //void setAdjustRates(uint8_t increasePct, uint8_t decreasePct);
      //void configSymType(uint8_t symbolLength, Quantity startPrice, Quantity floorPrice, uint8_t targetCreatedPerDay);

      void init();

      void create(SID newSymbol, Quantity maxDebit);
      void listSymbol(SID symbol, Quantity price);
      void buySymbol(SID symbol);
      void unlistSymbol(SID symbol);

      std::optional<psibase::HttpReply> serveSys(psibase::HttpRequest request);

      SymbolRecord       getSymbol(SID symbol);
      bool               exists(SID symbol);
      Quantity           getPrice(uint8_t numChars);
      SymbolLengthRecord getSymbolType(uint8_t numChars);
      void               updatePrices();

      // clang-format off
      struct Events
      {
         using Account    = psibase::AccountNumber;
         struct History
         {
            void symCreated(uint64_t prevEvent, SID symbol, Account owner, Quantity cost) {}
            void symListed(uint64_t prevEvent, SID symbol, Account seller, Quantity cost) {}
            void symSold(uint64_t prevEvent, SID symbol, Account buyer, Account seller, Quantity cost) {}
            void symUnlisted(uint64_t prevEvent, SID symbol, Account owner) {}

            void newCreatePrice(uint64_t prevEvent, uint8_t symbolLength, psibase::BlockNum blockNum, Quantity newPrice) {}
         };
         struct Ui{};
         struct Merkle{};
      };
      using SymbolEvents = psibase::EventIndex<&SymbolRecord::eventHead, "prevEvent">;
      using SymbolTypeEvents = psibase::EventIndex<&SymbolLengthRecord::eventHead, "prevEvent">;
      // clang-format on
   };

   // clang-format off
   PSIO_REFLECT(Symbol,
      method(init),
      method(create, newSymbol, maxDebit),
      method(listSymbol, symbol, price),
      method(buySymbol, symbol),
      method(unlistSymbol, symbol),
      method(serveSys, request),

      method(getSymbol, symbol),
      method(exists, symbol),
      method(getPrice, numChars),
      method(getSymbolType, numChars),
      method(updatePrices)
   );
   PSIBASE_REFLECT_EVENTS(Symbol);
   PSIBASE_REFLECT_HISTORY_EVENTS(Symbol,
      method(symCreated, prevEvent, symbol, owner, cost),
      method(symListed, prevEvent, symbol, seller, cost),
      method(symSold, prevEvent, symbol, buyer, seller, cost),
      method(symUnlisted, prevEvent, symbol, owner),
      method(newCreatePrice, prevEvent, symbolLength, blockNum, newPrice)
   );
   PSIBASE_REFLECT_UI_EVENTS(Symbol);
   PSIBASE_REFLECT_MERKLE_EVENTS(Symbol);
   // clang-format on

}  // namespace UserService
