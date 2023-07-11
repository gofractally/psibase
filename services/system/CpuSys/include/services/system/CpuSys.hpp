#pragma once

#include <psibase/Service.hpp>
#include <psibase/nativeTables.hpp>
#include <psio/chrono.hpp>

#include <chrono>

namespace SystemService
{
   // This service manages the active producers.
   // It must have native write permission
   class CpuSys : public psibase::Service<CpuSys>
   {
     public:
      static constexpr auto service = psibase::AccountNumber("cpu-sys");
      static constexpr auto serviceFlags =
          psibase::CodeRow::isSubjective | psibase::CodeRow::canSetTimeLimit;

      std::chrono::nanoseconds getCpuTime();
      void                     setCpuLimit(psibase::AccountNumber account);
   };
   PSIO_REFLECT(CpuSys, method(getCpuTime), method(setCpuLimit, limit))
}  // namespace SystemService
