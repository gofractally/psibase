#pragma once

#include <pthread.h>
#include <time.h>
#include <algorithm>
#include <atomic>
#include <cerrno>
#include <chrono>
#include <cstdint>
#include <exception>
#include <memory>
#include <stdexcept>
#include <string>
#include <system_error>

#ifdef __APPLE__
#include <psibase/DarwinCpuClock.hpp>
#endif

namespace psibase::accounting
{
   using Duration = std::chrono::nanoseconds;

   inline Duration rawCpu(clockid_t clock)
   {
      timespec time{};
      if (::clock_gettime(clock, &time))
         throw std::system_error(errno, std::system_category());
      return Duration(std::int64_t(time.tv_sec) * 1000000000 + time.tv_nsec);
   }

   // A target-thread clock must remain valid when sampled by the watchdog or
   // caller. On Darwin mach_thread_self owns a send right; retaining this
   // object retains that right, and the destructor releases exactly that right.
   class NativeThreadClock
   {
#ifdef __APPLE__
      std::shared_ptr<darwin::State> state = darwin::currentState();
#else
      clockid_t clock;
#endif

     public:
      NativeThreadClock()
      {
#ifdef __APPLE__
         // currentState explicitly reserves and checks the sampling signal.
#else
         if (auto error = pthread_getcpuclockid(pthread_self(), &clock))
            throw std::system_error(error, std::system_category());
#endif
      }
      NativeThreadClock(const NativeThreadClock&) = delete;
#ifdef __APPLE__
      auto nativeState() const { return state; }
#endif
      Duration read() const
      {
#ifdef __APPLE__
         if (darwin::current.load(std::memory_order_acquire) == state.get())
            state->observe(rawCpu(CLOCK_THREAD_CPUTIME_ID).count());
         else
         {
            const auto generation = darwin::request(state);
            const auto deadline   = std::chrono::steady_clock::now() + std::chrono::milliseconds(1);
            while (state->completed.load(std::memory_order_acquire) < generation &&
                   state->alive.load(std::memory_order_acquire) &&
                   std::chrono::steady_clock::now() < deadline)
               std::this_thread::sleep_for(std::chrono::microseconds(50));
            if (auto error = state->error.load(std::memory_order_relaxed))
               throw std::system_error(error, std::system_category());
            if (state->completed.load(std::memory_order_acquire) < generation &&
                state->alive.load(std::memory_order_acquire))
            {
               thread_basic_info_data_t info{};
               mach_msg_type_number_t   count = THREAD_BASIC_INFO_COUNT;
               const auto error = thread_info(state->port, THREAD_BASIC_INFO,
                                              reinterpret_cast<thread_info_t>(&info), &count);
               if (error == KERN_SUCCESS)
                  state->observe(
                      std::int64_t(info.user_time.seconds + info.system_time.seconds) * 1000000000 +
                      std::int64_t(info.user_time.microseconds + info.system_time.microseconds) *
                          1000);
               else if (error != KERN_TERMINATED && state->alive.load(std::memory_order_acquire))
                  throw std::runtime_error(
                      "Darwin CPU sampling timeout and Mach fallback failed: " +
                      std::to_string(error));
            }
         }
         return Duration(state->cpu.load(std::memory_order_relaxed));
#else
         return rawCpu(clock);
#endif
      }
   };

   inline std::shared_ptr<NativeThreadClock> currentThreadClock()
   {
      thread_local auto clock = std::make_shared<NativeThreadClock>();
      return clock;
   }
#ifdef __APPLE__
   class PublicationSignalMask
   {
      sigset_t prior;

     public:
      PublicationSignalMask()
      {
         sigset_t set;
         sigemptyset(&set);
         sigaddset(&set, darwin::signalNumber);
         if (auto error = pthread_sigmask(SIG_BLOCK, &set, &prior))
            throw std::system_error(error, std::system_category());
      }
      ~PublicationSignalMask()
      {
         if (pthread_sigmask(SIG_SETMASK, &prior, nullptr))
            std::terminate();
      }
   };
#else
   struct PublicationSignalMask
   {
   };
#endif
}  // namespace psibase::accounting
