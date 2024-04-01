#pragma once

#include <psibase/psibase.hpp>
#include <services/system/CommonTables.hpp>

namespace UserService
{
   namespace FractalNs
   {
      class CoreFractal : public psibase::Service<CoreFractal>
      {
        public:
         using Tables                  = psibase::ServiceTables<InitTable>;
         static constexpr auto service = psibase::AccountNumber("core-fractal");

         CoreFractal(psio::shared_view_ptr<psibase::Action> action);

         void init();

         bool isFracType();

         // clang-format off
         struct Events
         {
            struct History{};
            struct Ui{};
            struct Merkle{};
         };
         //using SymbolEvents = psibase::EventIndex<&SymbolRecord::eventHead, "prevEvent">;
         //using SymbolTypeEvents = psibase::EventIndex<&SymbolLengthRecord::eventHead, "prevEvent">;
         // clang-format on
      };

      // clang-format off
      PSIO_REFLECT(CoreFractal, method(init), method(isFracType)
      );
      PSIBASE_REFLECT_EVENTS(CoreFractal);
      PSIBASE_REFLECT_HISTORY_EVENTS(CoreFractal
      );
      PSIBASE_REFLECT_UI_EVENTS(CoreFractal);
      PSIBASE_REFLECT_MERKLE_EVENTS(CoreFractal);
      // clang-format on

   }  // namespace FractalNs
}  // namespace UserService
