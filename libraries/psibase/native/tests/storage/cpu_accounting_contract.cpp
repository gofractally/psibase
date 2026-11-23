#include <atomic>
#include <condition_variable>
#include <iostream>
#include <psibase/Watchdog.hpp>
#include <stdexcept>
#include <thread>

using namespace psibase;
using namespace std::chrono_literals;
void require(bool result, const char* text)
{
   if (!result)
      throw std::runtime_error(text);
}
template <class F>
void cancelled(F f)
{
   bool caught = false;
   try
   {
      f();
   }
   catch (const accounting::Cancelled&)
   {
      caught = true;
   }
   require(caught, "cancelled request was accepted");
}
int main()
{
   try
   {
      {
         // Two limits on one manager, reached by a thread that is only
         // waiting: elapsed time is what is measured and what is limited.
         std::mutex              mutex;
         std::condition_variable condition;
         std::atomic<unsigned>   fired = 0;
         WatchdogManager         manager;
         Watchdog                first(manager,
                                       [&]
                                       {
                                          fired.fetch_or(1);
                                          condition.notify_all();
                                       });
         Watchdog                second(manager,
                                        [&]
                                        {
                                           fired.fetch_or(2);
                                           condition.notify_all();
                                        });
         first.setLimit(10ms);
         second.setLimit(20ms);
         {
            std::unique_lock lock(mutex);
            require(condition.wait_for(lock, 3s, [&] { return fired.load() == 3; }),
                    "watchdogs did not fire while the thread was blocked");
         }
         const auto live = first.elapsed();
         require(live >= 20ms, "elapsed time omitted time spent blocked");
         require(first.elapsed() >= live, "clock decreased");
      }
      {
         // Paused time is not measured and cannot reach the limit; a request
         // scope does not reset the measurement.
         WatchdogManager   manager;
         std::atomic<bool> fired = false;
         Watchdog          wd(manager, [&] { fired = true; });
         wd.setLimit(200ms);
         wd.pause();
         const auto paused = wd.elapsed();
         std::this_thread::sleep_for(400ms);
         require(!fired, "paused time reached the limit");
         require(wd.elapsed() == paused, "paused time was measured");
         wd.resume();
         const auto before  = wd.elapsed();
         auto       request = std::make_shared<accounting::Request>([] { return true; });
         RunClock::duration inside;
         {
            accounting::Scope scope(request);
            inside = wd.elapsed();
         }
         require(inside >= before && wd.elapsed() >= inside, "scope reset the measurement");
      }
      {
         // A limit raised before it is reached is honoured; one lowered below
         // the elapsed time cancels.
         WatchdogManager   manager;
         std::atomic<bool> fired = false;
         Watchdog          wd(manager, [&] { fired = true; });
         wd.setLimit(300ms);
         std::this_thread::sleep_for(50ms);
         wd.setLimit(60s);
         while (wd.elapsed() < 600ms)
            std::this_thread::sleep_for(5ms);
         require(!fired, "cancelled on a limit that had been raised");
         wd.setLimit(1ms);
         for (int i = 0; i < 3000 && !fired; ++i)
            std::this_thread::sleep_for(1ms);
         require(fired, "lowered limit did not cancel");
      }
      {
         auto parent = std::make_shared<accounting::Request>([] { return true; });
         auto child  = std::make_shared<accounting::Request>([] { return true; });
         {
            accounting::Scope outer(parent);
            accounting::Scope inner(child);
            parent->cancel();
            cancelled([] { accounting::check(); });
            cancelled([] { accounting::Publication gate; });
         }
         auto              accepted = std::make_shared<accounting::Request>([] { return true; });
         accounting::Scope scope(accepted);
         accounting::Publication publication;
         std::thread             timeout([&] { accepted->cancel(); });
         timeout.join();
         accounting::check();
         unsigned effects = 0, callbacks = 0;
         {
            accounting::Publication nested;
            ++effects;
            ++callbacks;
            nested.finish();
         }
         cancelled([&] { publication.finish(); });
         require(effects == 1 && callbacks == 1, "accepted synchronous effects incomplete");
         cancelled([] { accounting::check(); });
      }
      {
         WatchdogManager manager;
         auto            watchdog = std::make_unique<Watchdog>(manager, [] {});
         auto            scope    = watchdog->accountingScope();
         watchdog.reset();
         cancelled([] { accounting::check(); });
         cancelled([] { accounting::Publication gate; });
      }
      std::cout << "{\"passed\":true,\"groups\":5,\"blocked_time_counts\":true,"
                   "\"limit_can_be_raised\":true,\"scoped_cancellation\":true}\n";
   }
   catch (const std::exception& e)
   {
      std::cerr << e.what() << '\n';
      return 1;
   }
}
