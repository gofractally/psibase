#include <psibase/Watchdog.hpp>

#include <cassert>
#include <system_error>

namespace psibase
{

   CpuClock::time_point CpuClock::now(clockid_t clock)
   {
      struct timespec result;
      if (::clock_gettime(clock, &result) < 0)
      {
         throw std::system_error(errno, std::system_category());
      }
      return time_point(duration(static_cast<rep>(result.tv_sec) * 1000000000 + result.tv_nsec));
   }

   WatchdogManager::WatchdogManager() : worker{[this] { run(); }} {}
   WatchdogManager::~WatchdogManager()
   {
      {
         std::lock_guard l{mutex};
         done = true;
      }
      cond.notify_one();
      worker.join();
   }
   void WatchdogManager::add(Watchdog* wd)
   {
      std::lock_guard l{mutex};
      children.push_back(wd);
      cond.notify_one();
   }
   void WatchdogManager::remove(Watchdog* wd)
   {
      std::lock_guard l{mutex};
      auto            pos = std::find(children.begin(), children.end(), wd);
      if (pos != children.end())
         children.erase(pos);
   }
   void WatchdogManager::run()
   {
      std::unique_lock l{mutex};
      while (!done)
      {
         auto iter = children.begin();
         // Limit the maximum wait to avoid integer overflow in wait_for
         CpuClock::duration earliest = std::chrono::days(1);
         for (Watchdog* child : children)
         {
            auto remaining = child->wait_duration();
            if (remaining.count() < 0)
            {
               child->interrupt();
            }
            else
            {
               earliest = std::min(earliest, remaining);
               *iter++  = child;
            }
         }
         children.erase(iter, children.end());
         cond.wait_for(l, earliest);
      }
   }

   Watchdog::Watchdog(WatchdogManager& m, std::function<void()> handler)
       : manager(&m),
         paused(false),
         elapsedOrStart(CpuClock::now().time_since_epoch()),
         handler(handler)
   {
#ifdef __APPLE__
      cpuclock = CLOCK_UPTIME_RAW;
#else
      if (int err = pthread_getcpuclockid(pthread_self(), &cpuclock))
      {
         throw std::system_error(err, std::system_category());
      }
#endif
      manager->add(this);
   }
   Watchdog::~Watchdog()
   {
      manager->remove(this);
   }
   void Watchdog::setLimit(CpuClock::duration dur)
   {
      assert(dur.count() >= 0);
      bool notify = dur < limit;
      {
         std::lock_guard l{manager->mutex};
         limit = dur;
      }
      if (notify)
      {
         manager->cond.notify_one();
      }
   }
   void Watchdog::pause()
   {
      assert(!paused);
      std::lock_guard l{manager->mutex};
      paused         = true;
      elapsedOrStart = CpuClock::now().time_since_epoch() - elapsedOrStart;
   }
   void Watchdog::resume()
   {
      assert(paused);
      {
         std::lock_guard l{manager->mutex};
         paused         = false;
         elapsedOrStart = CpuClock::now().time_since_epoch() - elapsedOrStart;
      }
      manager->cond.notify_one();
   }
   CpuClock::duration Watchdog::elapsed()
   {
      if (paused)
      {
         return elapsedOrStart;
      }
      else
      {
         return CpuClock::now().time_since_epoch() - elapsedOrStart;
      }
   }
   void Watchdog::interrupt()
   {
      handler();
   }
   CpuClock::duration Watchdog::wait_duration()
   {
      if (paused)
      {
         return CpuClock::duration::max();
      }
      else
      {
         return limit - (CpuClock::now(cpuclock).time_since_epoch() - elapsedOrStart);
      }
   }

}  // namespace psibase
