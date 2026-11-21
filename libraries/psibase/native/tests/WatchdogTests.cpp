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

#ifdef __APPLE__
TEST_CASE("Darwin target CPU clocks own and release their thread ports", "[accounting]")
{
   auto references = []
   {
      const auto port = mach_thread_self();
      mach_port_urefs_t count = 0;
      REQUIRE(mach_port_get_refs(mach_task_self(), port, MACH_PORT_RIGHT_SEND, &count) == KERN_SUCCESS);
      REQUIRE(mach_port_deallocate(mach_task_self(), port) == KERN_SUCCESS);
      return count;
   };
   const auto before = references();
   {
      std::vector<std::shared_ptr<accounting::NativeThreadClock>> clocks;
      for (unsigned i = 0; i < 32; ++i)
         clocks.push_back(std::make_shared<accounting::NativeThreadClock>());
      CHECK(references() == before + 32);
      bool valid = true;
      std::thread sampler([clocks, &valid]
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
