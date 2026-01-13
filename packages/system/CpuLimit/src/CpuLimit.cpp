#include <services/system/CpuLimit.hpp>

#include <time.h>
#include <psibase/api.hpp>
#include <psibase/dispatch.hpp>

#include <services/system/VirtualServer.hpp>

using psibase::check;

namespace SystemService
{
   std::chrono::nanoseconds CpuLimit::getCpuTime()
   {
      struct timespec result;
      check(::clock_gettime(CLOCK_PROCESS_CPUTIME_ID, &result) == 0, "clock_gettime");
      return std::chrono::seconds(result.tv_sec) + std::chrono::nanoseconds(result.tv_nsec);
   }

   void CpuLimit::setCpuLimit(std::optional<uint64_t> limit_ns)
   {
      check(psibase::getSender() == VirtualServer::service, "Unauthorized call to setCpuLimit");
      if (!limit_ns.has_value())
         return;

      psibase::raw::setMaxCpuTime(*limit_ns);
   }
}  // namespace SystemService

PSIBASE_DISPATCH(SystemService::CpuLimit)
