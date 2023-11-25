#include <services/system/CpuSys.hpp>

#include <time.h>
#include <psibase/dispatch.hpp>
#include <psibase/RawNativeFunctions.hpp>

#include <services/system/AccountSys.hpp>

using psibase::check;

namespace SystemService
{
   static constexpr std::chrono::nanoseconds leeway = std::chrono::milliseconds(1);

   std::chrono::nanoseconds CpuSys::getCpuTime()
   {
      struct timespec result;
      check(::clock_gettime(CLOCK_PROCESS_CPUTIME_ID, &result) == 0, "clock_gettime");
      return std::chrono::seconds(result.tv_sec) + std::chrono::nanoseconds(result.tv_nsec);
   }

   void CpuSys::setCpuLimit(psibase::AccountNumber account)
   {
      // Look up available CPU balance
      auto accountIndex =
          AccountSys::Tables(AccountSys::service).open<AccountTable>().getIndex<0>();
      auto row = accountIndex.get(account);
      check(!!row, "account does not exist");
      if (row->resourceBalance)
      {
         auto limit = row->resourceBalance->cpuLimit();
         // add leeway with saturation
         if (limit <= std::chrono::nanoseconds::max() - leeway)
         {
            limit += leeway;
         }
         else
         {
            limit = std::chrono::nanoseconds::max();
         }
         psibase::raw::setMaxTransactionTime(limit.count());
      }
   }
}  // namespace SystemService

PSIBASE_DISPATCH(SystemService::CpuSys)
