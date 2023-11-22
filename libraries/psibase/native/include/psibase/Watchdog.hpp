#pragma once

#include <chrono>
#include <condition_variable>
#include <functional>
#include <mutex>
#include <thread>
#include <vector>

#include <time.h>

namespace psibase
{

   struct CpuClock
   {
      using rep                       = std::int64_t;
      using period                    = std::ratio<1, 1000000000>;
      using duration                  = std::chrono::duration<rep, period>;
      using time_point                = std::chrono::time_point<CpuClock>;
      static constexpr bool is_steady = false;
#ifdef __APPLE__
      static time_point     now(clockid_t clock = CLOCK_MONOTONIC);
#else
      static time_point     now(clockid_t clock = CLOCK_THREAD_CPUTIME_ID);
#endif
   };

   class Watchdog;

   class WatchdogManager
   {
     public:
      WatchdogManager();
      ~WatchdogManager();

     private:
      friend class Watchdog;
      void                    add(Watchdog* wd);
      void                    remove(Watchdog* wd);
      void                    run();
      std::mutex              mutex;
      std::condition_variable cond;
      std::vector<Watchdog*>  children;
      bool                    done = false;
      std::thread             worker;
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

     private:
      friend class WatchdogManager;
      // Called with manager mutex held
      CpuClock::duration    wait_duration();
      WatchdogManager*      manager;
      bool                  paused;
      CpuClock::duration    elapsedOrStart;
      CpuClock::duration    limit = CpuClock::duration::max();
      clockid_t             cpuclock;
      std::function<void()> handler;
   };

}  // namespace psibase
