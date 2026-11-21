#include <psibase/Watchdog.hpp>

#include <atomic>
#include <chrono>
#include <thread>

#include <catch2/catch_all.hpp>

using namespace psibase;

TEST_CASE("Successive calls to CpuClock::now should not decrease")
{
   auto prev = CpuClock::now();
   for (int i = 0; i < 100; ++i)
   {
      auto next = CpuClock::now();
      CHECK(next >= prev);
      prev = next;
   }
}

TEST_CASE("CpuClock should not include time when the thread is suspended")
{
   auto start = CpuClock::now();
   std::this_thread::sleep_for(std::chrono::milliseconds(100));
   auto end = CpuClock::now();
   CHECK(end - start < std::chrono::milliseconds(50));
}

TEST_CASE("CpuClock should be associated with the current thread")
{
   std::atomic<bool>        done{false};
   std::chrono::nanoseconds t0_elapsed;
   auto                     start = CpuClock::now();
   std::thread              t0{[&]
                               {
                     auto start = CpuClock::now();
                     std::this_thread::sleep_for(std::chrono::milliseconds(50));
                     auto end   = CpuClock::now();
                     t0_elapsed = end - start;
                     done       = true;
                               }};
   while (!done)
   {
   }
   auto end = CpuClock::now();
   CHECK(t0_elapsed < std::chrono::microseconds(500));
   CHECK(end - start > std::chrono::milliseconds(10));
   t0.join();
}

#ifdef __APPLE__
TEST_CASE("Darwin target CPU clocks own and release their thread ports", "[accounting]")
{
   auto references = []
   {
      const auto        port  = mach_thread_self();
      mach_port_urefs_t count = 0;
      REQUIRE(mach_port_get_refs(mach_task_self(), port, MACH_PORT_RIGHT_SEND, &count) ==
              KERN_SUCCESS);
      REQUIRE(mach_port_deallocate(mach_task_self(), port) == KERN_SUCCESS);
      return count;
   };
   const auto before = references();
   {
      std::vector<std::shared_ptr<accounting::NativeThreadClock>> clocks;
      for (unsigned i = 0; i < 32; ++i)
         clocks.push_back(std::make_shared<accounting::NativeThreadClock>());
      // Clocks on one thread share the persistent sampler's owned port.
      CHECK(references() == before);
      bool        valid = true;
      std::thread sampler(
          [clocks, &valid]
          {
             for (const auto& clock : clocks)
                valid = valid && clock->read().count() >= 0;
          });
      sampler.join();
      CHECK(valid);
   }
   CHECK(references() == before);
}
#endif

TEST_CASE("Watchdog zero limit")
{
   std::atomic<bool> interrupted{false};
   WatchdogManager   manager;
   Watchdog          watchdog(manager, [&] { interrupted = true; });
   watchdog.setLimit(std::chrono::nanoseconds(0));
   while (!interrupted)
   {
   }
   CHECK(interrupted.load());
}

TEST_CASE("Watchdog required accuracy")
{
   constexpr int run_count        = 20;
   constexpr int allowed_failures = 4;
   int           failed           = 0;
   for (int i = 0; i < run_count; ++i)
   {
      std::atomic<bool> interrupted{false};
      WatchdogManager   manager;
      auto              duration = std::chrono::milliseconds(20);
      auto              start    = CpuClock::now();
      Watchdog          watchdog(manager, [&] { interrupted = true; });
      watchdog.setLimit(duration);
      while (!interrupted)
      {
      }
      auto end = CpuClock::now();
      CHECK(end - start >= duration);
      if (end - start - duration >= std::chrono::milliseconds(5))
      {
         ++failed;
         CHECK(failed <= allowed_failures);
      }
   }
}

TEST_CASE("Watchdog maximum limit")
{
   std::atomic<bool> interrupted{false};
   WatchdogManager   manager;
   auto              start = CpuClock::now();
   Watchdog          watchdog(manager, [&] { interrupted = true; });
   watchdog.setLimit(std::chrono::nanoseconds::max());
   while (CpuClock::now() - start < std::chrono::milliseconds(1))
   {
   }
   CHECK(!interrupted.load());
}

TEST_CASE("Watchdog threaded")
{
   constexpr int run_count        = 20;
   constexpr int allowed_failures = 5;
   int           failed           = 0;
   for (int i = 0; i < run_count; ++i)
   {
      INFO("run #" << i);
      WatchdogManager manager;

      static constexpr int     num_threads = 2;
      std::chrono::nanoseconds durations[num_threads];
      std::vector<std::thread> threads;

      for (int i = 0; i < num_threads; ++i)
      {
         threads.emplace_back(
             [&, i]
             {
                std::atomic<bool> interrupted{false};
                auto              start = CpuClock::now();
                Watchdog          watchdog(manager, [&] { interrupted = true; });
                watchdog.setLimit(std::chrono::milliseconds(i * 20));
                while (!interrupted)
                {
                }
                auto end     = CpuClock::now();
                durations[i] = end - start;
             });
      }

      for (auto& t : threads)
         t.join();
      threads.clear();
      for (int i = 0; i < num_threads; ++i)
      {
         CHECK(durations[i] >= std::chrono::milliseconds(i * 20));
         if (durations[i] - std::chrono::milliseconds(i * 20) >= std::chrono::milliseconds(5))
         {
            ++failed;
            CHECK(failed <= allowed_failures);
         }
      }
   }
}

namespace
{
   void burnCpu(std::chrono::nanoseconds duration)
   {
      const auto start = accounting::rawCpu(CLOCK_THREAD_CPUTIME_ID);
      while (accounting::rawCpu(CLOCK_THREAD_CPUTIME_ID) - start < duration)
      {
      }
   }
}  // namespace

TEST_CASE("Watchdogs and elapsed billing observe a live offloaded job", "[storage][accounting]")
{
   WatchdogManager         manager;
   std::mutex              mutex;
   std::condition_variable condition;
   std::atomic<unsigned>   fired   = 0;
   std::atomic<bool>       release = false, active = false;
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
   first.setLimit(std::chrono::milliseconds(10));
   second.setLimit(std::chrono::milliseconds(20));
   auto        counter = accounting::threadCounter();
   std::thread worker(
       [&]
       {
          accounting::ActiveJob cpu(counter);
          active = true;
          while (!release.load())
             burnCpu(std::chrono::milliseconds(1));
          active = false;
       });
   bool both;
   {
      std::unique_lock lock(mutex);
      both = condition.wait_for(lock, std::chrono::seconds(3), [&] { return fired.load() == 3; });
   }
   const bool stillActive       = active.load();
   const auto billedWhileActive = first.elapsed();
   release                      = true;
   worker.join();
   REQUIRE(both);
   REQUIRE(stillActive);
   CHECK(billedWhileActive >= std::chrono::milliseconds(20));
   CHECK(first.elapsed() >= billedWhileActive);
}

TEST_CASE("Queued wait is not CPU and request scopes never reset logical time",
          "[storage][accounting]")
{
   WatchdogManager   manager;
   std::atomic<bool> fired = false;
   Watchdog          watchdog(manager, [&] { fired = true; });
   watchdog.setLimit(std::chrono::milliseconds(30));
   const auto  start   = CpuClock::now();
   auto        counter = accounting::threadCounter();
   std::thread worker(
       [&]
       {
          std::this_thread::sleep_for(std::chrono::milliseconds(80));
          accounting::ActiveJob cpu(counter);
          burnCpu(std::chrono::milliseconds(5));
       });
   worker.join();
   const auto beforeScope = CpuClock::now();
   CHECK_FALSE(fired.load());
   CHECK(watchdog.elapsed() >= std::chrono::milliseconds(5));
   CHECK(watchdog.elapsed() < std::chrono::milliseconds(30));
   // Use an unbounded request for the monotonic scope check.
   auto                 request = std::make_shared<accounting::Request>([] { return true; });
   CpuClock::time_point inside;
   {
      accounting::Scope scope(request);
      inside = CpuClock::now();
   }
   CHECK(inside >= beforeScope);
   CHECK(CpuClock::now() >= inside);
   CHECK(beforeScope >= start);
}

TEST_CASE("Offloaded exceptions charge once and paused intervals stay excluded",
          "[storage][accounting]")
{
   WatchdogManager manager;
   Watchdog        watchdog(manager, [] {});
   auto            counter = accounting::threadCounter();
   watchdog.pause();
   const auto  paused = watchdog.elapsed();
   std::thread worker(
       [&]
       {
          try
          {
             accounting::ActiveJob cpu(counter);
             burnCpu(std::chrono::milliseconds(10));
             throw std::runtime_error("expected");
          }
          catch (const std::runtime_error&)
          {
          }
       });
   worker.join();
   CHECK(watchdog.elapsed() == paused);
   watchdog.resume();
   const auto resumed = watchdog.elapsed();
   CHECK(resumed - paused < std::chrono::milliseconds(5));
   std::thread next(
       [&]
       {
          accounting::ActiveJob cpu(counter);
          burnCpu(std::chrono::milliseconds(5));
       });
   next.join();
   CHECK(watchdog.elapsed() - resumed >= std::chrono::milliseconds(5));
}

TEST_CASE("Cancelled requests cannot enter publication; accepted effects complete synchronously",
          "[storage][accounting]")
{
   auto request = std::make_shared<accounting::Request>([] { return true; });
   {
      accounting::Scope scope(request);
      request->cancel();
      CHECK_THROWS_AS(accounting::Publication{}, accounting::Cancelled);
   }
   auto                    accepted = std::make_shared<accounting::Request>([] { return true; });
   accounting::Scope       acceptedScope(accepted);
   accounting::Publication publication;
   std::thread             timeout([&] { accepted->cancel(); });
   timeout.join();
   CHECK_NOTHROW(accepted->check());
   unsigned effects = 0, callbacks = 0;
   {
      accounting::Publication nested;
      ++effects;
      ++callbacks;
      nested.finish();
   }
   CHECK_THROWS_AS(publication.finish(), accounting::Cancelled);
   CHECK(effects == 1);
   CHECK(callbacks == 1);
   CHECK_THROWS_AS(accepted->check(), accounting::Cancelled);
}

TEST_CASE("Nested request scopes retain parent cancellation and closed watchdogs fail closed",
          "[storage][accounting]")
{
   auto parent = std::make_shared<accounting::Request>([] { return true; });
   auto child  = std::make_shared<accounting::Request>([] { return true; });
   {
      accounting::Scope outer(parent);
      accounting::Scope inner(child);
      parent->cancel();
      CHECK_THROWS_AS(accounting::check(), accounting::Cancelled);
      CHECK_THROWS_AS(accounting::Publication{}, accounting::Cancelled);
   }
   WatchdogManager manager;
   auto            watchdog = std::make_unique<Watchdog>(manager, [] {});
   auto            scope    = watchdog->accountingScope();
   watchdog.reset();
   CHECK_THROWS_AS(accounting::check(), accounting::Cancelled);
   CHECK_THROWS_AS(accounting::Publication{}, accounting::Cancelled);
}
