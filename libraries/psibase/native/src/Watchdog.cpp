#include <psibase/Watchdog.hpp>

#include <algorithm>
#include <cassert>

namespace psibase
{
   namespace
   {
      auto toSteady(RunClock::time_point time)
      {
         return std::chrono::steady_clock::time_point(
             std::chrono::duration_cast<std::chrono::steady_clock::duration>(
                 time.time_since_epoch()));
      }
   }  // namespace

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
   void WatchdogManager::deadlineChanged(const std::optional<RunClock::time_point>& deadline)
   {
      if (deadline && *deadline < nextLook)
         cond.notify_one();
   }
   void WatchdogManager::add(Watchdog* wd)
   {
      std::lock_guard l{mutex};
      children.push_back(wd);
      deadlineChanged(wd->deadline());
   }
   void WatchdogManager::remove(Watchdog* wd)
   {
      // Taking the mutex waits for a cancellation of this watchdog that is in
      // progress: the worker cancels with the mutex held.
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
         const auto now  = RunClock::now();
         auto       look = now + idlePeriod;
         for (Watchdog* child : children)
         {
            if (child->cancelled)
            {
               // Still here after it was cancelled: deliver it again. Its
               // owner removes it when the run has ended.
               // EXPERIMENT ONLY: no repetition, to show the engine fix alone.
               continue;
            }
            // The deadline is read here, under the mutex, so it reflects every
            // setLimit that has returned. A deadline that has moved later since
            // the worker went to sleep simply is not due yet.
            const auto deadline = child->deadline();
            if (deadline && *deadline <= now)
            {
               child->cancelled = true;
               child->interrupt();
            }
            else if (deadline && *deadline < look)
               look = *deadline;
         }
         nextLook = look;
         cond.wait_until(l, toSteady(look));
      }
   }

   Watchdog::Watchdog(WatchdogManager& m, std::function<void()> handler)
       : manager(&m), runningSince(RunClock::now()), handler(std::move(handler))
   {
      // The request is cancelled by the manager's worker, never by the thread
      // that checks it.
      request = std::make_shared<accounting::Request>([] { return true; });
      manager->add(this);
   }
   Watchdog::~Watchdog()
   {
      manager->remove(this);
      request->close();
   }
   void Watchdog::setLimit(RunClock::duration dur)
   {
      assert(dur.count() >= 0);
      std::lock_guard l{manager->mutex};
      limit = dur;
      manager->deadlineChanged(deadline());
   }
   void Watchdog::pause()
   {
      std::lock_guard l{manager->mutex};
      assert(!paused);
      accumulated = elapsedAt(RunClock::now());
      paused      = true;
   }
   void Watchdog::resume()
   {
      std::lock_guard l{manager->mutex};
      assert(paused);
      paused       = false;
      runningSince = RunClock::now();
      manager->deadlineChanged(deadline());
   }
   RunClock::duration Watchdog::elapsed()
   {
      std::lock_guard l{manager->mutex};
      return elapsedAt(RunClock::now());
   }
   void Watchdog::interrupt()
   {
      request->cancel();
      handler();
   }
   RunClock::duration Watchdog::elapsedAt(RunClock::time_point now) const
   {
      return paused ? accumulated : accumulated + (now - runningSince);
   }
   std::optional<RunClock::time_point> Watchdog::deadline() const
   {
      // A paused run has no deadline. Neither does one whose limit is beyond
      // any time that can be reached (which also keeps the sum from wrapping).
      constexpr RunClock::duration unreachable = std::chrono::hours(24 * 365 * 100);
      if (paused)
         return std::nullopt;
      const auto remaining = limit - accumulated;
      if (remaining >= unreachable)
         return std::nullopt;
      return runningSince + remaining;
   }

}  // namespace psibase
