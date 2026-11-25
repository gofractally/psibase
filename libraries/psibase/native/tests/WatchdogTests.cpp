#include <psibase/Watchdog.hpp>

#include <atomic>
#include <chrono>
#include <thread>

#include <catch2/catch_all.hpp>

using namespace psibase;
using namespace std::chrono_literals;

// Timing tests assert in one direction only: something has not happened by a
// time well before it is due, or does happen eventually. Nothing here depends
// on a thread being scheduled promptly.
namespace
{
   struct Watched
   {
      std::atomic<bool> interrupted{false};
      WatchdogManager   manager;
      Watchdog          watchdog{manager, [this] { interrupted = true; }};
      bool              waitInterrupted(std::chrono::milliseconds limit)
      {
         const auto end = RunClock::now() + limit;
         while (!interrupted && RunClock::now() < end)
            std::this_thread::sleep_for(1ms);
         return interrupted;
      }
   };
}  // namespace

TEST_CASE("Successive calls to RunClock::now should not decrease")
{
   auto prev = RunClock::now();
   for (int i = 0; i < 1000; ++i)
   {
      auto next = RunClock::now();
      CHECK(next >= prev);
      prev = next;
   }
}

TEST_CASE("Elapsed time includes time the thread is blocked")
{
   Watched w;
   std::this_thread::sleep_for(20ms);
   CHECK(w.watchdog.elapsed() >= 20ms);
}

TEST_CASE("A blocked thread reaches its limit")
{
   Watched w;
   w.watchdog.setLimit(20ms);
   CHECK(w.waitInterrupted(5000ms));
   CHECK(w.watchdog.elapsed() >= 20ms);
}

TEST_CASE("Watchdog zero limit")
{
   Watched w;
   w.watchdog.setLimit(std::chrono::nanoseconds(0));
   CHECK(w.waitInterrupted(5000ms));
}

TEST_CASE("Watchdog does not fire early")
{
   for (int i = 0; i < 20; ++i)
   {
      std::atomic<RunClock::rep> firedAt{0};
      WatchdogManager            manager;
      const auto                 start = RunClock::now();
      Watchdog watchdog(manager, [&] { firedAt = RunClock::now().time_since_epoch().count(); });
      watchdog.setLimit(20ms);
      while (!firedAt)
      {
      }
      CHECK(RunClock::duration(firedAt.load()) - start.time_since_epoch() >= 20ms);
   }
}

TEST_CASE("Watchdog maximum limit")
{
   Watched w;
   w.watchdog.setLimit(std::chrono::nanoseconds::max());
   std::this_thread::sleep_for(2 * std::chrono::duration_cast<std::chrono::milliseconds>(
                                       WatchdogManager::idlePeriod));
   CHECK(!w.interrupted.load());
}

TEST_CASE("Watchdog threaded")
{
   for (int run = 0; run < 10; ++run)
   {
      WatchdogManager          manager;
      static constexpr int     num_threads = 3;
      RunClock::duration       durations[num_threads];
      std::vector<std::thread> threads;
      for (int i = 0; i < num_threads; ++i)
         threads.emplace_back(
             [&, i]
             {
                std::atomic<bool> interrupted{false};
                const auto        start = RunClock::now();
                Watchdog          watchdog(manager, [&] { interrupted = true; });
                watchdog.setLimit(std::chrono::milliseconds(i * 20));
                while (!interrupted)
                {
                }
                durations[i] = RunClock::now() - start;
             });
      for (auto& t : threads)
         t.join();
      for (int i = 0; i < num_threads; ++i)
         CHECK(durations[i] >= std::chrono::milliseconds(i * 20));
   }
}

TEST_CASE("Paused time is not measured and has no deadline")
{
   Watched w;
   w.watchdog.setLimit(100ms);
   w.watchdog.pause();
   const auto paused = w.watchdog.elapsed();
   std::this_thread::sleep_for(300ms);
   CHECK(!w.interrupted.load());
   CHECK(w.watchdog.elapsed() == paused);
   w.watchdog.resume();
   CHECK(w.watchdog.elapsed() < 100ms);
   // What is left of the limit still applies once it runs again.
   CHECK(w.waitInterrupted(5000ms));
   CHECK(w.watchdog.elapsed() >= 100ms);
}

// A limit can be raised while the run is in progress, for example because
// resources were funded just in time.

TEST_CASE("A limit raised before the old deadline runs to the new one")
{
   Watched w;
   w.watchdog.setLimit(300ms);
   std::this_thread::sleep_for(50ms);
   w.watchdog.setLimit(1500ms);
   // Well past the old deadline, well short of the new one.
   while (w.watchdog.elapsed() < 600ms)
      std::this_thread::sleep_for(5ms);
   if (w.watchdog.elapsed() < 1200ms)  // not so delayed that the new limit is due
      CHECK(!w.interrupted.load());
   CHECK(w.waitInterrupted(10000ms));
   CHECK(w.watchdog.elapsed() >= 1500ms);
}

TEST_CASE("A limit raised repeatedly in steps is honoured each time")
{
   Watched    w;
   const auto step = 300ms;
   w.watchdog.setLimit(step);
   bool late = false;
   for (int i = 1; i <= 5 && !late; ++i)
   {
      // Raise a third of a step before the current limit would expire.
      const auto raiseAt = step * i - 100ms;
      while (w.watchdog.elapsed() < raiseAt)
         std::this_thread::sleep_for(2ms);
      late = w.watchdog.elapsed() >= step * i;  // this thread was delayed past the limit
      if (!late)
         w.watchdog.setLimit(step * (i + 1));
   }
   if (!late)
   {
      // Five limits have come and gone.
      CHECK(w.watchdog.elapsed() >= step * 5 - 100ms);
      if (w.watchdog.elapsed() < step * 6 - 100ms)
         CHECK(!w.interrupted.load());
   }
   CHECK(w.waitInterrupted(10000ms));
}

TEST_CASE("A limit raised while paused applies when the run resumes")
{
   Watched w;
   w.watchdog.setLimit(100ms);
   w.watchdog.pause();
   w.watchdog.setLimit(1500ms);
   std::this_thread::sleep_for(300ms);
   w.watchdog.resume();
   while (w.watchdog.elapsed() < 400ms)
      std::this_thread::sleep_for(5ms);
   if (w.watchdog.elapsed() < 1200ms)
      CHECK(!w.interrupted.load());
   CHECK(w.waitInterrupted(10000ms));
   CHECK(w.watchdog.elapsed() >= 1500ms);
}

TEST_CASE("A raise racing the deadline never cancels after setLimit has returned")
{
   // Either outcome is right: cancelled at the old limit, or running to the
   // new one. What must not happen is a cancellation that comes after the
   // raise returned, decided on the old limit. And it must not hang.
   unsigned cancelledFirst = 0, raisedFirst = 0;
   for (int i = 0; i < 300; ++i)
   {
      Watched    w;
      const auto limit = std::chrono::microseconds(500 + (i % 7) * 250);
      w.watchdog.setLimit(limit);
      while (w.watchdog.elapsed() < limit - std::chrono::microseconds(40 * (i % 5)))
      {
      }
      w.watchdog.setLimit(10s);
      const bool atReturn = w.interrupted.load();
      // Longer than the worker's idle period: if it were going to cancel on
      // the old limit it would have by now.
      std::this_thread::sleep_for(
          std::chrono::duration_cast<std::chrono::milliseconds>(WatchdogManager::idlePeriod) + 5ms);
      REQUIRE(w.interrupted.load() == atReturn);
      ++(atReturn ? cancelledFirst : raisedFirst);
   }
   INFO("cancelled first " << cancelledFirst << ", raised first " << raisedFirst);
   CHECK(cancelledFirst + raisedFirst == 300);
}

TEST_CASE("A limit lowered below the elapsed time cancels promptly")
{
   Watched w;
   w.watchdog.setLimit(60s);
   std::this_thread::sleep_for(50ms);
   CHECK(!w.interrupted.load());
   const auto lowered = RunClock::now();
   w.watchdog.setLimit(1ms);
   CHECK(w.waitInterrupted(5000ms));
   // The worker is woken for it; it does not wait for its next idle look.
   CHECK(RunClock::now() - lowered < 2000ms);
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
