#pragma once

#include <psibase/Service.hpp>
#include <psibase/nativeTables.hpp>

namespace SystemService
{
   struct VerifySig : psibase::Service
   {
      static constexpr auto     service      = psibase::AccountNumber("verify-sig");
      static constexpr uint64_t serviceFlags = psibase::CodeRow::isAuthService;
   };
   PSIO_REFLECT(VerifySig)
}  // namespace SystemService
