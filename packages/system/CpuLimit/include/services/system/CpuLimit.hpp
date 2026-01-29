#pragma once

#include <psibase/Service.hpp>
#include <psibase/nativeTables.hpp>
#include <psio/chrono.hpp>

#include <chrono>

namespace SystemService
{
   // This service limits CPU consumption during a transaction.
   class CpuLimit : public psibase::Service
   {
     public:
      static constexpr auto service      = psibase::AccountNumber("cpu-limit");
      static constexpr auto serviceFlags = psibase::CodeRow::isPrivileged;

      std::chrono::nanoseconds getCpuTime();
      void                     setCpuLimit(std::optional<uint64_t> limit_ns);
   };
   PSIO_REFLECT(CpuLimit, method(getCpuTime), method(setCpuLimit, limit_ns))
   PSIBASE_REFLECT_TABLES(CpuLimit)
}  // namespace SystemService
