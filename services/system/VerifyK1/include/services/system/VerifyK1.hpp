#pragma once

#include <psibase/RawNativeFunctions.hpp>
#include <psibase/nativeTables.hpp>

namespace SystemService
{
   namespace VerifyK1
   {
      static constexpr auto     service      = psibase::AccountNumber("verifyk1");
      static constexpr uint64_t serviceFlags = psibase::CodeRow::isAuthService;
   }  // namespace VerifyK1
}  // namespace SystemService
