#include <services/system/CpuLimit.hpp>

#include <time.h>
#include <psibase/api.hpp>
#include <psibase/dispatch.hpp>

#include <services/system/VirtualServer.hpp>

using psibase::check;

namespace SystemService
{
   static constexpr std::chrono::nanoseconds leeway = std::chrono::milliseconds(1);

   std::chrono::nanoseconds CpuLimit::getCpuTime()
   {
      struct timespec result;
      check(::clock_gettime(CLOCK_PROCESS_CPUTIME_ID, &result) == 0, "clock_gettime");
      return std::chrono::seconds(result.tv_sec) + std::chrono::nanoseconds(result.tv_nsec);
   }

   void CpuLimit::setCpuLimit(psibase::AccountNumber account)
   {
      auto cpu_limit = psibase::to<VirtualServer>().getCpuLimit(account);

      if (!cpu_limit.has_value())
         return;

      auto limit = std::chrono::nanoseconds(*cpu_limit);

      // add leeway with saturation
      if (limit <= std::chrono::nanoseconds::max() - leeway)
      {
         limit += leeway;
      }
      else
      {
         limit = std::chrono::nanoseconds::max();
      }

      psibase::raw::setMaxCpuTime(limit.count());
   }
}  // namespace SystemService

PSIBASE_DISPATCH(SystemService::CpuLimit)
