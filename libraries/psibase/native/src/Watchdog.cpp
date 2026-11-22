#include <psibase/Watchdog.hpp>

#include <cassert>
#include <system_error>

namespace psibase
{

   CpuClock::time_point CpuClock::now()
   {
      return time_point(accounting::currentThreadClock()->read() +
                        accounting::threadCounter()->sample());
   }

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
   // A budget is CPU time, which passes no faster than the clock the worker
   // sleeps on, so a budget with `remaining` left cannot run out before
   // now + remaining. If the worker is already due by then there is nothing
   // to tell it. Waking it regardless made it run, and take this mutex, on
   // every pause and resume of every transaction: several times per action.
   void WatchdogManager::checkWithin(CpuClock::duration remaining)
   {
      const auto now = std::chrono::steady_clock::now();
      if (nextCheck > now && remaining < nextCheck - now)
      {
         nextCheck = {};
         cond.notify_one();
      }
   }
   void WatchdogManager::add(Watchdog* wd)
   {
      std::lock_guard l{mutex};
      children.push_back(wd);
      checkWithin(wd->wait_duration());
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
         nextCheck = std::chrono::steady_clock::now() +
                     std::chrono::duration_cast<std::chrono::steady_clock::duration>(earliest);
         cond.wait_for(l, earliest);
      }
   }

   Watchdog::Watchdog(WatchdogManager& m, std::function<void()> handler)
       : manager(&m),
         extraCpu(accounting::threadCounter()),
         cpuclock(accounting::currentThreadClock()),
         paused(false),
         elapsedOrStart(CpuClock::now().time_since_epoch()),
         handler(handler)
   {
      publishBudget();
      request = std::make_shared<accounting::Request>([this] { return remaining().count() >= 0; });
      extraCpu->subscribe(this, [manager = &m] { manager->cond.notify_one(); });
      manager->add(this);
   }
   Watchdog::~Watchdog()
   {
      manager->remove(this);
      extraCpu->unsubscribe(this);
      request->close();
   }
   void Watchdog::setLimit(CpuClock::duration dur)
   {
      assert(dur.count() >= 0);
      std::lock_guard l{manager->mutex};
      const bool      sooner = dur < limit;
      limit                  = dur;
      publishBudget();
      if (sooner)
         manager->checkWithin(remaining());
   }
   void Watchdog::pause()
   {
      assert(!paused);
      std::lock_guard l{manager->mutex};
      paused         = true;
      elapsedOrStart = logicalNow() - elapsedOrStart;
      publishBudget();
   }
   void Watchdog::resume()
   {
      assert(paused);
      std::lock_guard l{manager->mutex};
      paused         = false;
      elapsedOrStart = logicalNow() - elapsedOrStart;
      publishBudget();
      manager->checkWithin(remaining());
   }
   CpuClock::duration Watchdog::elapsed()
   {
      const auto budget = std::atomic_load(&publishedBudget);
      if (budget->paused)
      {
         return budget->elapsedOrStart;
      }
      else
      {
         return logicalNow() - budget->elapsedOrStart;
      }
   }
   void Watchdog::interrupt()
   {
      request->cancel();
      handler();
   }
   CpuClock::duration Watchdog::wait_duration()
   {
      return remaining();
   }
   CpuClock::duration Watchdog::logicalNow() const
   {
      return cpuclock->read() + extraCpu->sample();
   }
   void Watchdog::publishBudget()
   {
      std::atomic_store(&publishedBudget,
                        std::make_shared<const Budget>(Budget{paused, elapsedOrStart, limit}));
   }
   CpuClock::duration Watchdog::remaining() const
   {
      const auto budget = std::atomic_load(&publishedBudget);
      if (budget->paused)
      {
         return CpuClock::duration::max();
      }
      else
      {
         return budget->limit - (logicalNow() - budget->elapsedOrStart);
      }
   }

}  // namespace psibase
