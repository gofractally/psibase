#pragma once

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <functional>
#include <mutex>
#include <psibase/CpuAccounting.hpp>
#include <thread>
#include <vector>

#include <time.h>
#ifdef __APPLE__
#include <psibase/DarwinWatchdogWake.hpp>
#endif

namespace psibase
{

   struct CpuClock
   {
      using rep                       = std::int64_t;
      using period                    = std::ratio<1, 1000000000>;
      using duration                  = std::chrono::duration<rep, period>;
      using time_point                = std::chrono::time_point<CpuClock>;
      static constexpr bool is_steady = false;
      static time_point     now();                 // logical caller CPU, including live owner jobs
      static time_point     now(clockid_t clock);  // raw explicit host clock
   };

   class Watchdog;

   class WatchdogManager
   {
     public:
      WatchdogManager();
      ~WatchdogManager();

     private:
      friend class Watchdog;
      void       add(Watchdog* wd);
      void       remove(Watchdog* wd);
      void       run();
      std::mutex mutex;
#ifdef __APPLE__
      DarwinWatchdogWake cond;
#else
      std::condition_variable cond;
#endif
      std::vector<Watchdog*> children;
      bool                   done = false;
      std::thread            worker;
   };

   class Watchdog
   {
     public:
      Watchdog(WatchdogManager& m, std::function<void()> f);
      ~Watchdog();
      void               setLimit(CpuClock::duration dur);
      void               pause();
      void               resume();
      CpuClock::duration elapsed();
      void               interrupt();
      accounting::Scope  accountingScope() { return accounting::Scope(request); }

     private:
      friend class WatchdogManager;
      // Called with manager mutex held
      CpuClock::duration wait_duration();
      CpuClock::duration remaining() const;
      CpuClock::duration logicalNow() const;
      void               publishBudget();
      struct Budget
      {
         bool               paused;
         CpuClock::duration elapsedOrStart;
         CpuClock::duration limit;
      };
      WatchdogManager*                               manager;
      std::shared_ptr<accounting::Counter>           extraCpu;
      std::shared_ptr<accounting::NativeThreadClock> cpuclock;
      std::shared_ptr<accounting::Request>           request;
      std::shared_ptr<const Budget> publishedBudget;  // atomic_load/store for libc++ compatibility
      bool                          paused;
      CpuClock::duration            elapsedOrStart;
      CpuClock::duration            limit = CpuClock::duration::max();
      std::function<void()>         handler;
   };

}  // namespace psibase
