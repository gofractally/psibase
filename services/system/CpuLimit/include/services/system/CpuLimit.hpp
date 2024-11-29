#pragma once

#include <psibase/Service.hpp>
#include <psibase/nativeTables.hpp>
#include <psio/chrono.hpp>

#include <chrono>

namespace SystemService
{
   // This service manages the active producers.
   // It must have native write permission
   class CpuLimit : public psibase::Service
   {
     public:
      static constexpr auto service = psibase::AccountNumber("cpu-limit");
      static constexpr auto serviceFlags =
          psibase::CodeRow::isSubjective | psibase::CodeRow::canSetTimeLimit;

      std::chrono::nanoseconds getCpuTime();
      void                     setCpuLimit(psibase::AccountNumber account);
   };
   PSIO_REFLECT(CpuLimit, method(getCpuTime), method(setCpuLimit, account))
}  // namespace SystemService
