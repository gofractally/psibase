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
      using Tables = psibase::
          ServiceTables<SymbolTable, SymbolLengthTable, InitTable>;

      static constexpr auto service        = psibase::AccountNumber("symbol");
      static constexpr auto sysTokenSymbol = SID{"psi"};

      Symbol(psio::shared_view_ptr<psibase::Action> action);

      void init();

      void create(SID newSymbol);

      std::optional<psibase::HttpReply> serveSys(psibase::HttpRequest request);

      SymbolRecord       getSymbol(SID symbol);
      bool               exists(SID symbol);
      Quantity           getPrice(uint8_t numChars);
      SymbolLengthRecord getSymbolType(uint8_t numChars);

      // clang-format off
      struct Events
      {
         using Account    = psibase::AccountNumber;
         struct History
         {
            void symCreated(SID symbol, Account owner, Quantity cost) {}
            void symSold(SID symbol, Account buyer, Account seller, Quantity cost) {}
         };
         struct Ui{};
         struct Merkle{};
      };
      // clang-format on
   };

   // clang-format off
   PSIO_REFLECT(Symbol,
      method(init),
      method(create, newSymbol),
      method(serveSys, request),

      method(getSymbol, symbol),
      method(exists, symbol),
      method(getPrice, numChars),
      method(getSymbolType, numChars),
   );
   PSIBASE_REFLECT_EVENTS(Symbol);
   PSIBASE_REFLECT_HISTORY_EVENTS(Symbol,
      method(symCreated, symbol, owner, cost),
      method(symSold, symbol, buyer, seller, cost),
   );
   PSIBASE_REFLECT_UI_EVENTS(Symbol);
   PSIBASE_REFLECT_MERKLE_EVENTS(Symbol);

   PSIBASE_REFLECT_TABLES(Symbol, Symbol::Tables)
   // clang-format on

}  // namespace UserService
