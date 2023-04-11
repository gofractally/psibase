#pragma once

#include <psibase/nativeFunctions.hpp>
#include <psibase/nativeTables.hpp>

namespace SystemService
{
   namespace VerifyEcSys
   {
      static constexpr auto     service      = psibase::AccountNumber("verifyec-sys");
      static constexpr uint64_t serviceFlags = psibase::CodeRow::isAuthService;
   }  // namespace VerifyEcSys
}  // namespace SystemService
