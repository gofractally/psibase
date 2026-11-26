#pragma once

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <functional>
#include <memory>
#include <mutex>
#include <optional>
#include <psibase/CpuAccounting.hpp>
#include <thread>
#include <vector>

namespace psibase
{
   // The one clock execution is measured with: elapsed time on the monotonic
   // clock. An action's trace time, a transaction's limit and what it is
   // billed all read it, so the three are comparable. Time a transaction
   // spends blocked or descheduled is part of what it cost. Reading it is not
   // a system call.
   struct RunClock
   {
      using rep                       = std::int64_t;
      using period                    = std::ratio<1, 1000000000>;
      using duration                  = std::chrono::duration<rep, period>;
      using time_point                = std::chrono::time_point<RunClock>;
      static constexpr bool is_steady = true;
      static time_point     now()
      {
         return time_point(std::chrono::duration_cast<duration>(
             std::chrono::steady_clock::now().time_since_epoch()));
      }
   };

   class Watchdog;
   extern std::atomic<bool> psibaseWatchdogDiagReport;

   // One thread that cancels whichever watchdog's deadline has passed. The
   // threads being watched never evaluate their own limits.
   //
   // The first cancellation of a run is delivered when its deadline passes:
   // the worker sleeps until the earliest deadline, so that is as exact as
   // the scheduler. A run that is still there afterwards is cancelled again
   // every time the worker looks (every idlePeriod) for as long as its
   // watchdog exists. That repetition is a guarantee, not the mechanism: on
   // wasmtime one delivery is sufficient (the engine was fixed so that a
   // tick cannot be missed, gofractally/psibase#2263). It is still needed
   // for the psizam engines, where a single delivery has been seen to be
   // lost and the cause is not yet known; when it is, this can be
   // reconsidered. The handler therefore has to tolerate being called more
   // than once.
   class WatchdogManager
   {
     public:
      WatchdogManager();
      ~WatchdogManager();

      // The worker looks at the deadlines at least this often. A deadline
      // further away than this never needs the worker to be woken, so starting
      // a transaction with an ordinary limit costs no system call.
      static constexpr RunClock::duration idlePeriod = std::chrono::milliseconds(20);

     private:
      friend class Watchdog;
      void add(Watchdog* wd);
      void remove(Watchdog* wd);
      void run();
      // Called with mutex held when a watchdog's deadline is set or moved.
      // Wakes the worker only if the deadline is before its next look.
      void deadlineChanged(const std::optional<RunClock::time_point>& deadline);

      std::mutex              mutex;
      std::condition_variable cond;
      std::vector<Watchdog*>  children;
      bool                    done = false;
      // When the worker will next look at the deadlines if nothing wakes it.
      // Guarded by mutex; the worker holds the mutex whenever it is awake.
      RunClock::time_point nextLook{};
      std::thread          worker;
   };

   // Measures a run and cancels it at a limit.
   //
   //    deadline = (when it last started running) + limit - (time run before that)
   //
   // The deadline is recomputed under the manager's mutex whenever the limit
   // changes or the run is resumed. A limit can be raised while the run is in
   // progress, for example by funding resources just in time: a raise that
   // returns before the worker has cancelled is honoured, and the worker never
   // cancels on a limit that is no longer current. A raise after the cancel
   // changes nothing; the budget had already run out.
   class Watchdog
   {
     public:
      Watchdog(WatchdogManager& m, std::function<void()> f);
      ~Watchdog();
      void               setLimit(RunClock::duration dur);
      // Time between pause() and resume() is not measured.
      void               pause();
      void               resume();
      RunClock::duration elapsed();
      void               interrupt();
      accounting::Scope  accountingScope() { return accounting::Scope(request); }

     private:
      friend class WatchdogManager;
      // Both called with the manager's mutex held.
      std::optional<RunClock::time_point> deadline() const;
      RunClock::duration                  elapsedAt(RunClock::time_point now) const;

      WatchdogManager*                     manager;
      std::shared_ptr<accounting::Request> request;
      // Guarded by the manager's mutex.
      bool                  paused = false;
      RunClock::duration    accumulated{0};
      RunClock::time_point  runningSince;
      RunClock::duration    limit = RunClock::duration::max();
      std::function<void()> handler;
      // Its deadline has passed and it has been cancelled; from then on it
      // is cancelled again on every look.
      bool cancelled = false;
      RunClock::time_point diagCancelledAt{};
   };

}  // namespace psibase
