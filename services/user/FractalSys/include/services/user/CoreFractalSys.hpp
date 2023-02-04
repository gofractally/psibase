#pragma once

#include <psibase/psibase.hpp>
#include <services/system/CommonTables.hpp>

namespace UserService
{
   namespace Fractal
   {
      class CoreFractalSys : public psibase::Service<CoreFractalSys>
      {
        public:
         using Tables                  = psibase::ServiceTables<InitTable>;
         static constexpr auto service = psibase::AccountNumber("core-frac-sys");

         CoreFractalSys(psio::shared_view_ptr<psibase::Action> action);

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
      PSIO_REFLECT(CoreFractalSys, method(init), method(isFracType)
      );
      PSIBASE_REFLECT_EVENTS(CoreFractalSys);
      PSIBASE_REFLECT_HISTORY_EVENTS(CoreFractalSys
      );
      PSIBASE_REFLECT_UI_EVENTS(CoreFractalSys);
      PSIBASE_REFLECT_MERKLE_EVENTS(CoreFractalSys);
      // clang-format on

   }  // namespace Fractal
}  // namespace UserService
