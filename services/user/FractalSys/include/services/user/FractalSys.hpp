#pragma once

#include <psibase/psibase.hpp>
#include <services/system/CommonTables.hpp>
#include <services/user/fractalErrors.hpp>
#include <services/user/fractalTables.hpp>

namespace UserService
{
   namespace Fractal
   {
      class FractalSys : public psibase::Service<FractalSys>
      {
        public:
         using Tables = psibase::ServiceTables<InitTable>;

         static constexpr auto service = psibase::AccountNumber("fractal-sys");

         FractalSys(psio::shared_view_ptr<psibase::Action> action);

         void init();

         // clang-format off
         struct Events
         {
            struct History
            {
            };
            struct Ui{};
            struct Merkle{};
         };
         //using SymbolEvents = psibase::EventIndex<&SymbolRecord::eventHead, "prevEvent">;
         //using SymbolTypeEvents = psibase::EventIndex<&SymbolLengthRecord::eventHead, "prevEvent">;
         // clang-format on
      };

      // clang-format off
      PSIO_REFLECT(FractalSys,
         method(init)
      );
      PSIBASE_REFLECT_EVENTS(FractalSys);
      PSIBASE_REFLECT_HISTORY_EVENTS(FractalSys
      );
      PSIBASE_REFLECT_UI_EVENTS(FractalSys);
      PSIBASE_REFLECT_MERKLE_EVENTS(FractalSys);
      // clang-format on

   }  // namespace Fractal

}  // namespace UserService
