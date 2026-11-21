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
void burn(std::chrono::nanoseconds time)
{
   auto start = accounting::rawCpu(CLOCK_THREAD_CPUTIME_ID);
   while (accounting::rawCpu(CLOCK_THREAD_CPUTIME_ID) - start < time)
   {
   }
}
int main()
{
   try
   {
      {
         auto                    counter = accounting::threadCounter();
         std::atomic<bool>       active = false, run = false;
         std::mutex              mutex;
         std::condition_variable condition;
         std::atomic<unsigned>   fired = 0;
         std::jthread            worker(
             [&](std::stop_token stop)
             {
                accounting::ActiveJob cpu(counter);
                active = true;
                condition.notify_all();
                while (!run && !stop.stop_requested())
                   std::this_thread::sleep_for(1ms);
                while (!stop.stop_requested())
                   burn(1ms);
                active = false;
             });
         {
            std::unique_lock lock(mutex);
            require(condition.wait_for(lock, 3s, [&] { return active.load(); }),
                    "owner job did not start");
         }
         WatchdogManager manager;
         Watchdog        first(manager,
                               [&]
                               {
                           fired.fetch_or(1);
                           condition.notify_all();
                               });
         Watchdog        second(manager,
                                [&]
                                {
                            fired.fetch_or(2);
                            condition.notify_all();
                                });
         first.setLimit(10ms);
         second.setLimit(20ms);
         run = true;
         {
            std::unique_lock lock(mutex);
            require(condition.wait_for(lock, 3s, [&] { return fired.load() == 3; }),
                    "watchdogs did not see live worker CPU");
         }
         require(active, "owner finished before live watchdog observation");
         const auto live = first.elapsed();
         require(live >= 20ms, "live billable time omitted worker CPU");
         worker.request_stop();
         worker.join();
         require(first.elapsed() >= live, "clock decreased at job completion");
      }
      {
         WatchdogManager   manager;
         std::atomic<bool> fired = false;
         Watchdog          wd(manager, [&] { fired = true; });
         wd.setLimit(30ms);
         auto        counter = accounting::threadCounter();
         std::thread worker(
             [&]
             {
                std::this_thread::sleep_for(80ms);
                accounting::ActiveJob cpu(counter);
                burn(5ms);
             });
         worker.join();
         require(!fired, "queued wait counted as CPU");
         require(wd.elapsed() >= 5ms && wd.elapsed() < 30ms, "CPU time wrong after queue wait");
         const auto           before  = CpuClock::now();
         auto                 request = std::make_shared<accounting::Request>([] { return true; });
         CpuClock::time_point inside;
         {
            accounting::Scope scope(request);
            inside = CpuClock::now();
         }
         require(inside >= before && CpuClock::now() >= inside,
                 "scope reset cumulative clock debt");
      }
      {
         WatchdogManager manager;
         Watchdog        wd(manager, [] {});
         auto            counter = accounting::threadCounter();
         wd.pause();
         auto                     paused = wd.elapsed();
         const auto               before = counter->sample();
         std::chrono::nanoseconds measured{};
         std::thread              worker(
             [&]
             {
                auto start = accounting::rawCpu(CLOCK_THREAD_CPUTIME_ID);
                try
                {
                   accounting::ActiveJob cpu(counter);
                   burn(10ms);
                   throw std::runtime_error("expected");
                }
                catch (const std::runtime_error&)
                {
                }
                measured = accounting::rawCpu(CLOCK_THREAD_CPUTIME_ID) - start;
             });
         worker.join();
         require(counter->sample() - before >= 10ms && counter->sample() - before <= measured + 1ms,
                 "exception CPU charged more or less than once");
         require(wd.elapsed() == paused, "paused work was billed");
         wd.resume();
         auto        start = wd.elapsed();
         std::thread next(
             [&]
             {
                accounting::ActiveJob cpu(counter);
                burn(5ms);
             });
         next.join();
         require(wd.elapsed() - start >= 5ms, "exception cleanup lost subsequent CPU");
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
#ifdef __APPLE__
      {
         auto references = []
         {
            const auto        port  = mach_thread_self();
            mach_port_urefs_t count = 0;
            require(mach_port_get_refs(mach_task_self(), port, MACH_PORT_RIGHT_SEND, &count) ==
                        KERN_SUCCESS,
                    "thread port ref query failed");
            require(mach_port_deallocate(mach_task_self(), port) == KERN_SUCCESS,
                    "thread port probe release failed");
            return count;
         };
         const auto before = references();
         {
            std::vector<std::shared_ptr<accounting::NativeThreadClock>> clocks;
            for (unsigned i = 0; i < 32; ++i)
               clocks.push_back(std::make_shared<accounting::NativeThreadClock>());
            require(references() == before,
                    "shared thread sampler unexpectedly acquired more port rights");
            std::thread sampler(
                [clocks]
                {
                   for (auto& clock : clocks)
                      require(clock->read().count() >= 0, "remote CPU sample invalid");
                });
            sampler.join();
         }
         require(references() == before, "thread port send rights leaked");
      }
#endif
      std::cout << "{\"passed\":true,\"groups\":5,\"live_cpu\":true,\"cumulative_clock\":true,"
                   "\"scoped_cancellation\":true}\n";
   }
   catch (const std::exception& e)
   {
      std::cerr << e.what() << '\n';
      return 1;
   }
}
