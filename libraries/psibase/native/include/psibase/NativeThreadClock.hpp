#pragma once

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
#include <pthread.h>
#include <time.h>

#ifdef __APPLE__
#include <mach/mach.h>
#include <mach/thread_info.h>
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
      const pthread_t owner = pthread_self();
      const thread_t port = mach_thread_self();
      mutable std::atomic<std::int64_t> observed{};
#else
      clockid_t clock;
#endif

     public:
      NativeThreadClock()
      {
#ifdef __APPLE__
         if (port == MACH_PORT_NULL)
            throw std::runtime_error("mach_thread_self failed");
#else
         if (auto error = pthread_getcpuclockid(pthread_self(), &clock))
            throw std::system_error(error, std::system_category());
#endif
      }
      NativeThreadClock(const NativeThreadClock&) = delete;
      ~NativeThreadClock()
      {
#ifdef __APPLE__
         if (mach_port_deallocate(mach_task_self(), port) != KERN_SUCCESS)
            std::terminate();
#endif
      }
      Duration read() const
      {
#ifdef __APPLE__
         Duration value;
         if (pthread_equal(owner, pthread_self()))
         {
            value = rawCpu(CLOCK_THREAD_CPUTIME_ID);
         }
         else
         {
            thread_basic_info_data_t info{};
            mach_msg_type_number_t count = THREAD_BASIC_INFO_COUNT;
            const auto error = thread_info(port, THREAD_BASIC_INFO,
                                           reinterpret_cast<thread_info_t>(&info), &count);
            if (error != KERN_SUCCESS)
               throw std::runtime_error("thread_info CPU clock failed: " +
                                        std::to_string(error));
            value = std::chrono::seconds(std::int64_t(info.user_time.seconds) +
                                         info.system_time.seconds) +
                    std::chrono::microseconds(std::int64_t(info.user_time.microseconds) +
                                              info.system_time.microseconds);
         }
         // Remote Mach samples have microsecond precision and can lag a self
         // sample. Preserve the largest actually observed CPU measurement;
         // never advance from elapsed wall time or guessed CPU consumption.
         auto prior = observed.load(std::memory_order_relaxed);
         while (prior < value.count() &&
                !observed.compare_exchange_weak(prior, value.count(),
                                               std::memory_order_relaxed))
         {
         }
         return Duration(std::max(prior, value.count()));
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
}  // namespace psibase::accounting
