#pragma once
#include <mach/mach.h>
#include <pthread.h>
#include <signal.h>
#include <time.h>
#include <algorithm>
#include <atomic>
#include <cerrno>
#include <chrono>
#include <cstdint>
#include <exception>
#include <memory>
#include <mutex>
#include <stdexcept>
#include <system_error>
#include <thread>

namespace psibase::accounting::darwin
{
   inline std::chrono::nanoseconds rawCpu(clockid_t clock)
   {
      timespec time{};
      if (clock_gettime(clock, &time))
         throw std::system_error(errno, std::system_category());
      return std::chrono::nanoseconds(std::int64_t(time.tv_sec) * 1000000000 + time.tv_nsec);
   }
   inline constexpr int signalNumber = SIGUSR2;
   static_assert(std::atomic<std::uint64_t>::is_always_lock_free);
   static_assert(std::atomic<std::int64_t>::is_always_lock_free);
   static_assert(std::atomic<bool>::is_always_lock_free);
   static_assert(std::atomic<int>::is_always_lock_free);
   static_assert(std::atomic<std::uintptr_t>::is_always_lock_free);
   struct State
   {
      const pthread_t             owner = pthread_self();
      const thread_t              port  = mach_thread_self();
      std::mutex                  sendMutex;
      std::atomic<bool>           alive{true};
      std::atomic<std::uint64_t>  requested{}, completed{}, handled{};
      std::atomic<std::int64_t>   cpu{};
      std::atomic<int>            error{};
      std::atomic<std::uintptr_t> stackLow{}, stackHigh{};
      std::atomic<bool>           usedAltStack{};
      State()
      {
         if (port == MACH_PORT_NULL)
            throw std::runtime_error("mach_thread_self failed for CPU sampling");
      }
      ~State()
      {
         if (mach_port_deallocate(mach_task_self(), port) != KERN_SUCCESS)
            std::terminate();
      }
      void observe(std::int64_t value) noexcept
      {
         auto previous = cpu.load(std::memory_order_relaxed);
         while (previous < value &&
                !cpu.compare_exchange_weak(previous, value, std::memory_order_relaxed))
         {
         }
      }
   };
   static_assert(std::atomic<State*>::is_always_lock_free);
   inline thread_local std::atomic<State*> current{nullptr};
   inline void                             handler(int) noexcept
   {
      const auto savedErrno = errno;
      if (auto* state = current.load(std::memory_order_acquire))
      {
         const auto generation = state->requested.load(std::memory_order_acquire);
         if (generation != state->completed.load(std::memory_order_relaxed))
         {
            timespec value{};
            if (clock_gettime(CLOCK_THREAD_CPUTIME_ID, &value) == 0)
               state->observe(std::int64_t(value.tv_sec) * 1000000000 + value.tv_nsec);
            else
               state->error.store(errno, std::memory_order_relaxed);
            const auto stack = std::uintptr_t(&value);
            if (stack >= state->stackLow.load(std::memory_order_relaxed) &&
                stack < state->stackHigh.load(std::memory_order_relaxed))
               state->usedAltStack.store(true, std::memory_order_relaxed);
            state->handled.fetch_add(1, std::memory_order_relaxed);
            state->completed.store(generation, std::memory_order_release);
         }
      }
      errno = savedErrno;
   }
   inline void reserve()
   {
      // This is an explicit process-lifetime reservation. Never restore SIG_DFL:
      // a queued late delivery must still find a harmless installed handler.
      static auto*     mutex     = new std::mutex;
      static bool      installed = false;
      std::lock_guard  lock(*mutex);
      struct sigaction action{};
      if (sigaction(signalNumber, nullptr, &action))
         throw std::system_error(errno, std::system_category());
      if (installed)
      {
         constexpr int checkedFlags =
             SA_RESTART | SA_ONSTACK | SA_RESETHAND | SA_NODEFER | SA_SIGINFO;
         if (action.sa_handler != handler ||
             (action.sa_flags & checkedFlags) != (SA_RESTART | SA_ONSTACK))
            throw std::runtime_error("reserved SIGUSR2 CPU sampler handler or flags were replaced");
         return;
      }
      if (action.sa_handler != SIG_DFL)
         throw std::runtime_error("SIGUSR2 is already reserved");
      sigemptyset(&action.sa_mask);
      action.sa_handler = handler;
      action.sa_flags   = SA_RESTART | SA_ONSTACK;
      if (sigaction(signalNumber, &action, nullptr))
         throw std::system_error(errno, std::system_category());
      installed = true;
   }
   struct ThreadOwner
   {
      std::shared_ptr<State> state = std::make_shared<State>();
      ThreadOwner()
      {
         sigset_t mask;
         if (auto error = pthread_sigmask(SIG_SETMASK, nullptr, &mask))
            throw std::system_error(error, std::system_category());
         if (sigismember(&mask, signalNumber))
            throw std::runtime_error("SIGUSR2 is blocked on CPU-accounted thread");
         reserve();
         state->observe(rawCpu(CLOCK_THREAD_CPUTIME_ID).count());
         current.store(state.get(), std::memory_order_release);
      }
      ~ThreadOwner()
      {
         std::lock_guard lock(state->sendMutex);
         state->observe(rawCpu(CLOCK_THREAD_CPUTIME_ID).count());
         current.store(nullptr, std::memory_order_release);
         state->alive.store(false, std::memory_order_release);
      }
   };
   inline std::shared_ptr<State> currentState()
   {
      thread_local ThreadOwner owner;
      return owner.state;
   }
   inline std::uint64_t request(const std::shared_ptr<State>& state)
   {
      reserve();
      std::lock_guard lock(state->sendMutex);
      if (!state->alive.load(std::memory_order_acquire))
         return state->completed.load(std::memory_order_acquire);
      auto generation = state->requested.load(std::memory_order_relaxed);
      if (generation == state->completed.load(std::memory_order_acquire))
      {
         state->requested.store(++generation, std::memory_order_release);
         if (auto error = pthread_kill(state->owner, signalNumber); error && error != ESRCH)
            throw std::system_error(error, std::system_category());
      }
      return generation;
   }
}  // namespace psibase::accounting::darwin
