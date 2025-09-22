#include <services/test/TestClock.hpp>

#include <psibase/dispatch.hpp>

#include <time.h>
#include <cerrno>
#include <chrono>
#include <string>

using psibase::CallFlags;
using psibase::check;

void validate_timespec(const struct timespec& ts)
{
   check(ts.tv_nsec >= 0 && ts.tv_nsec < 1000000000,
         "tv_nsec out of range: " + std::to_string(ts.tv_nsec));
}

void check_err(int err)
{
   check(err == 0, "errno: " + std::to_string(errno));
}

void TestClock::testReal(bool indirect)
{
   if (indirect)
   {
      return recurse().with_flags(CallFlags::runModeRpc).testReal(false);
   }
   struct timespec time;
   auto            err = ::clock_gettime(CLOCK_REALTIME, &time);
   check_err(err);
   validate_timespec(time);
}

void TestClock::testMono(bool indirect)
{
   if (indirect)
   {
      return recurse().with_flags(CallFlags::runModeRpc).testMono(false);
   }
   struct timespec time1;
   auto            err = ::clock_gettime(CLOCK_MONOTONIC, &time1);
   check_err(err);
   validate_timespec(time1);
   struct timespec time2;
   err = ::clock_gettime(CLOCK_MONOTONIC, &time2);
   check_err(err);
   validate_timespec(time2);
   check(time1.tv_sec < time2.tv_sec ||
             (time1.tv_sec == time2.tv_sec && time1.tv_nsec <= time2.tv_nsec),
         "monotonic clock must not decrease");
}

void TestClock::testCpu(bool indirect)
{
   if (indirect)
   {
      return recurse().with_flags(CallFlags::runModeRpc).testCpu(false);
   }
   struct timespec time1;
   auto            err = ::clock_gettime(CLOCK_PROCESS_CPUTIME_ID, &time1);
   check_err(err);
   validate_timespec(time1);
   check(time1.tv_sec == 0 && time1.tv_nsec < 5000000, "CPU time too large");
   struct timespec time2;
   err = ::clock_gettime(CLOCK_PROCESS_CPUTIME_ID, &time2);
   check_err(err);
   validate_timespec(time2);
   check(time2.tv_sec == 0 && time2.tv_nsec < 5000000, "CPU time too large");
   check(time1.tv_nsec <= time2.tv_nsec, "cpu clock must not decrease");
}

void TestClock::testSystem(bool indirect)
{
   if (indirect)
   {
      return recurse().with_flags(CallFlags::runModeRpc).testSystem(false);
   }
   std::chrono::system_clock::now();
}

//void TestClock::testUtc() {
//   std::chrono::utc_clock::now();
//}

void TestClock::testSteady(bool indirect)
{
   if (indirect)
   {
      return recurse().with_flags(CallFlags::runModeRpc).testSteady(false);
   }
   auto t1 = std::chrono::steady_clock::now();
   auto t2 = std::chrono::steady_clock::now();
   check(t1 <= t2, "std::chrono::steady_clock must not decrease");
}

void TestClock::testHiRes(bool indirect)
{
   if (indirect)
   {
      return recurse().with_flags(CallFlags::runModeRpc).testHiRes(false);
   }
   std::chrono::high_resolution_clock::now();
}

PSIBASE_DISPATCH(TestClock)
