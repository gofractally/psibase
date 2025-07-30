#pragma once

#include <psibase/Service.hpp>
#include <psibase/nativeTables.hpp>

namespace TestService
{
   struct SetWasmConfig : psibase::Service
   {
      static constexpr auto service = psibase::AccountNumber{"wasm-config"};
      static constexpr auto flags   = psibase::CodeRow::allowWriteNative;
      void                  setWasmCfg(psibase::NativeTableNum table, psibase::WasmConfigRow row);
   };
   PSIO_REFLECT(SetWasmConfig, method(setWasmCfg, table, row))
}  // namespace TestService
