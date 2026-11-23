#pragma once

#include <cstdint>
#include <optional>
#include <psibase/psibase.hpp>

#include <services/system/CommonTables.hpp>
#include <services/user/symbolErrors.hpp>
#include <services/user/symbolTables.hpp>
#include <services/user/tokenTypes.hpp>
#include "psibase/AccountNumber.hpp"

namespace UserService
{
   class Symbol : public psibase::Service
   {
     public:
      using Tables = psibase::ServiceTables<InitTable, SymbolLengthTable, SymbolTable>;

      static constexpr auto service        = psibase::AccountNumber("symbol");
      static constexpr auto sysTokenSymbol = SID{"psi"};

      Symbol(psio1::shared_view_ptr<psibase::Action> action);

      void init();

      void create(SID symbol);
      void admin_create(SID symbol, psibase::AccountNumber recipient);

      SymbolRecord           getSymbol(SID symbol);
      bool                   exists(SID symbol);
      Quantity               getPrice(uint8_t length);
      SymbolLengthRecord     getSymbolType(uint8_t length);
      void                   mapSymbol(TID token_id, SID symbol);
      void                   sellLength(uint8_t  length,
                                        Quantity initial_price,
                                        uint32_t target,
                                        Quantity floor_price);
      SID                    getTokenSym(TID token_id);
      std::optional<Mapping> getByToken(TID token_id);
      std::optional<Mapping> getMapBySym(psibase::AccountNumber symbol);
      void                   delLength(uint8_t length);

      // clang-format off
      struct Events
      {
         using Account    = psibase::AccountNumber;
         struct History
         {
            void symEvent(SID symbol, Account actor, uint8_t action) {}
         };
      };
      // clang-format on
   };

   // clang-format off
   PSIO_REFLECT(Symbol,
      method(init),
      method(create, symbol),
      method(admin_create, symbol, recipient),
      method(mapSymbol, token_id, symbol),
      method(sellLength, length, initial_price, target, floor_price),
      method(getSymbol, symbol),
      method(exists, symbol),
      method(getPrice, length),
      method(getTokenSym, token_id),
      method(getSymbolType, length),
      method(getByToken, token_id),
      method(getMapBySym, symbol),
      method(delLength, length),
   );
   PSIBASE_REFLECT_HISTORY_EVENTS(Symbol,
      method(symEvent, symbol, actor, action),
   );

   PSIBASE_REFLECT_TABLES(Symbol, Symbol::Tables)
   // clang-format on

}  // namespace UserService
