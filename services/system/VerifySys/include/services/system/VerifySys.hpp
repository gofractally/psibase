#pragma once

#include <psibase/Service.hpp>
#include <psibase/nativeTables.hpp>

namespace SystemService
{
   struct VerifySys : psibase::Service<VerifySys>
   {
      static constexpr auto     service      = psibase::AccountNumber("verify-sys");
      static constexpr uint64_t serviceFlags = psibase::CodeRow::isAuthService;
   };
   PSIO_REFLECT(VerifySys)
}  // namespace SystemService
