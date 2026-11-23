#pragma once

#include <sys/resource.h>
#include <time.h>
#include <unistd.h>
#include <array>
#include <atomic>
#include <cinttypes>
#include <csignal>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <memory>
#include <mutex>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>
#ifdef __APPLE__
#include <libproc.h>
#endif

// Optional process diagnostics only. No billed CPU, action traces, service APIs,
// database values, or consensus decisions depend on these counters.
namespace psibase::query_cpu_profile
{
   enum class Bucket : unsigned
   {
      wasm,
      native,
      database,
      none
   };

   struct Charge
   {
      Bucket        bucket;
      std::uint64_t nanoseconds;
   };

   // Kept separate from the clock and aggregation so nested/reentrant timing
   // can be checked with deterministic timestamps.
   struct ExclusiveLedger
   {
      Bucket        current = Bucket::none;
      std::uint64_t since   = 0;

      Charge transition(Bucket next, std::uint64_t now) noexcept
      {
         Charge result{current, current != Bucket::none && now >= since ? now - since : 0};
         current = next;
         since   = now;
         return result;
      }
   };

   inline std::uint64_t processStartUnixSeconds() noexcept
   {
#ifdef __APPLE__
      proc_bsdinfo info{};
      if (proc_pidinfo(getpid(), PROC_PIDTBSDINFO, 0, &info, sizeof(info)) == sizeof(info))
         return info.pbi_start_tvsec;
#elif defined(__linux__)
      try
      {
         std::ifstream status{"/proc/self/stat"};
         std::string   line;
         if (!std::getline(status, line))
            return 0;
         auto close = line.rfind(')');
         if (close == std::string::npos)
            return 0;
         std::istringstream fields{line.substr(close + 2)};
         std::string        field;
         for (unsigned n = 3; n <= 22; ++n)
            if (!(fields >> field))
               return 0;
         const auto    startTicks = std::stoull(field);
         const auto    ticks      = sysconf(_SC_CLK_TCK);
         std::ifstream boot{"/proc/stat"};
         while (std::getline(boot, line))
            if (line.starts_with("btime ") && ticks > 0)
               return std::stoull(line.substr(6)) + startTicks / ticks;
      }
      catch (...)
      {
      }
#endif
      return 0;
   }

   // Apple Silicon has 128-byte cache lines. A record has exactly one writer;
   // relaxed atomic loads/stores also make rejected concurrent samples legal.
   struct alignas(128) ThreadCounters
   {
      std::array<std::atomic<std::uint64_t>, 3> cpu{};
      std::array<std::atomic<std::uint64_t>, 3> calls{};
      std::atomic<std::uint64_t>                clockErrors{0};
   };
   static_assert(std::atomic<std::uint64_t>::is_always_lock_free);

   struct State
   {
      alignas(128) std::atomic<std::uint64_t> active{0};
      std::atomic<std::uint64_t> generation{0};
      alignas(128) std::atomic<std::uint64_t> processClockErrors{0};
      std::uint64_t                                sequence     = 0;
      const std::uint64_t                          processStart = processStartUnixSeconds();
      std::mutex                                   dumpMutex;
      std::mutex                                   registryMutex;
      std::vector<std::unique_ptr<ThreadCounters>> threads;
   };

   inline State& state()
   {
      // Remain valid for the final atexit checkpoint, irrespective of static
      // destruction order in the node and Wasmtime libraries.
      static auto* value = new State;
      return *value;
   }

   inline ThreadCounters& threadCounters()
   {
      static thread_local auto* record = []
      {
         auto            owned = std::make_unique<ThreadCounters>();
         auto*           value = owned.get();
         auto&           s     = state();
         std::lock_guard lock{s.registryMutex};
         // Retain records after thread exit so cumulative CPU is never lost.
         s.threads.push_back(std::move(owned));
         return value;
      }();
      return *record;
   }

   struct Totals
   {
      std::array<std::uint64_t, 3> cpu{};
      std::array<std::uint64_t, 3> calls{};
      std::uint64_t                clockErrors = 0;
   };

   inline Totals aggregate()
   {
      Totals          result;
      auto&           s = state();
      std::lock_guard lock{s.registryMutex};
      for (const auto& thread : s.threads)
      {
         for (unsigned i = 0; i < 3; ++i)
         {
            result.cpu[i] += thread->cpu[i].load(std::memory_order_relaxed);
            result.calls[i] += thread->calls[i].load(std::memory_order_relaxed);
         }
         result.clockErrors += thread->clockErrors.load(std::memory_order_relaxed);
      }
      return result;
   }

   inline std::atomic<std::sig_atomic_t> requested{0};
   static_assert(decltype(requested)::is_always_lock_free);

   inline void requestDump(int) noexcept
   {
      // The handler performs no clock reads, allocation, locking, or I/O.
      requested.store(1, std::memory_order_relaxed);
   }

   inline std::uint64_t processCpu() noexcept
   {
      rusage usage{};
      if (getrusage(RUSAGE_SELF, &usage) != 0)
      {
         ++state().processClockErrors;
         return 0;
      }
      return (std::uint64_t(usage.ru_utime.tv_sec) + usage.ru_stime.tv_sec) * 1'000'000'000 +
             (std::uint64_t(usage.ru_utime.tv_usec) + usage.ru_stime.tv_usec) * 1'000;
   }

   inline void dumpLocked(State& s) noexcept
   {
      const auto generation = s.generation.load(std::memory_order_seq_cst);
      if (s.active.load(std::memory_order_seq_cst) != 0)
      {
         requested.store(1, std::memory_order_relaxed);
         return;
      }
      const auto totals    = aggregate();
      const auto wasm      = totals.cpu[0];
      const auto host      = totals.cpu[1];
      const auto db        = totals.cpu[2];
      const auto wasmCalls = totals.calls[0];
      const auto hostCalls = totals.calls[1];
      const auto dbCalls   = totals.calls[2];
      // Read process CPU after the closed segments, so concurrent additions
      // cannot make their sum appear newer than this process checkpoint.
      const auto process = processCpu();
      const auto clockErrors =
          totals.clockErrors + s.processClockErrors.load(std::memory_order_relaxed);
      if (s.active.load(std::memory_order_seq_cst) != 0 ||
          s.generation.load(std::memory_order_seq_cst) != generation)
      {
         // A different thread entered a scope during the sample. Do not
         // publish partial intervals as native residual, or block that thread.
         requested.store(1, std::memory_order_relaxed);
         return;
      }
      const auto scoped = wasm + host + db;
      std::fprintf(
          stderr,
          "QUERY_CPU_PROFILE {\"schema\":1,\"pid\":%ld,\"process_start_unix_seconds\":%" PRIu64
          ",\"snapshot_seq\":%" PRIu64 ",\"process_cpu_ns\":%" PRIu64 ",\"wasm_cpu_ns\":%" PRIu64
          ",\"host_native_cpu_ns\":%" PRIu64 ",\"db_cpu_ns\":%" PRIu64
          ",\"native_residual_cpu_ns\":%" PRIu64 ",\"wasm_scopes\":%" PRIu64
          ",\"host_native_scopes\":%" PRIu64 ",\"db_scopes\":%" PRIu64 ",\"active_scopes\":%" PRIu64
          ",\"clock_errors\":%" PRIu64 "}\n",
          long(getpid()), s.processStart, ++s.sequence, process, wasm, host, db,
          process > scoped ? process - scoped : 0, wasmCalls, hostCalls, dbCalls, std::uint64_t{0},
          clockErrors);
   }

   inline void dump() noexcept
   {
      auto&           s = state();
      std::lock_guard lock{s.dumpMutex};
      dumpLocked(s);
   }

   inline bool enabled()
   {
      static const bool on = []
      {
         if (!std::getenv("PSIBASE_QUERY_CPU_PROFILE"))
            return false;
#ifndef PSIBASE_VM_WASMTIME
         throw std::runtime_error(
             "PSIBASE_QUERY_CPU_PROFILE requires a WASMTIME-only native build");
#endif
         if (std::getenv("PSIBASE_CALL_PROFILE"))
            throw std::runtime_error(
                "PSIBASE_QUERY_CPU_PROFILE and PSIBASE_CALL_PROFILE both require SIGUSR1");
         struct sigaction previous{};
         if (sigaction(SIGUSR1, nullptr, &previous) != 0 ||
             (previous.sa_handler != SIG_DFL && previous.sa_handler != SIG_IGN))
            throw std::runtime_error("SIGUSR1 is already reserved; cannot enable CPU profiling");
         struct sigaction action{};
         action.sa_handler = &requestDump;
         sigemptyset(&action.sa_mask);
         if (sigaction(SIGUSR1, &action, nullptr) != 0)
            throw std::runtime_error("Cannot install CPU profiling SIGUSR1 handler");
         (void)state();
         std::atexit(&dump);
         std::fprintf(stderr,
                      "QUERY_CPU_PROFILE_ENABLED "
                      "{\"schema\":1,\"pid\":%ld,\"process_start_unix_seconds\":%" PRIu64
                      ",\"signal\":\"SIGUSR1\"}\n",
                      long(getpid()), state().processStart);
         return true;
      }();
      return on;
   }

   inline std::uint64_t threadCpu() noexcept
   {
      static thread_local std::uint64_t previous = 0;
      timespec                          time{};
      if (clock_gettime(CLOCK_THREAD_CPUTIME_ID, &time) != 0)
      {
         auto& errors = threadCounters().clockErrors;
         errors.store(errors.load(std::memory_order_relaxed) + 1, std::memory_order_relaxed);
         return previous;
      }
      return previous = std::uint64_t(time.tv_sec) * 1'000'000'000 + time.tv_nsec;
   }

   inline void checkpoint() noexcept
   {
      if (!requested.load(std::memory_order_relaxed))
         return;
      auto&           s = state();
      std::lock_guard lock{s.dumpMutex};
      if (requested.exchange(0, std::memory_order_relaxed))
         dumpLocked(s);
   }

   struct Scope
   {
      static inline thread_local ExclusiveLedger ledger;
      static inline thread_local unsigned        depth    = 0;
      static inline thread_local ThreadCounters* counters = nullptr;
      bool                                       on;
      Bucket                                     previous = Bucket::none;

      explicit Scope(Bucket bucket) : on(enabled())
      {
         if (!on)
            return;
         if (depth == 0)
         {
            checkpoint();
            if (!counters)
               counters = &threadCounters();
            auto& s = state();
            s.active.fetch_add(1, std::memory_order_seq_cst);
            s.generation.fetch_add(1, std::memory_order_seq_cst);
         }
         previous = ledger.current;
         charge(ledger.transition(bucket, threadCpu()));
         ++depth;
         auto& calls = counters->calls[unsigned(bucket)];
         calls.store(calls.load(std::memory_order_relaxed) + 1, std::memory_order_relaxed);
      }
      Scope(const Scope&)            = delete;
      Scope& operator=(const Scope&) = delete;
      ~Scope()
      {
         if (!on)
            return;
         charge(ledger.transition(previous, threadCpu()));
         if (--depth == 0)
         {
            state().active.fetch_sub(1, std::memory_order_seq_cst);
            checkpoint();
         }
      }
      static void charge(Charge value) noexcept
      {
         if (value.bucket != Bucket::none)
         {
            auto& cpu = counters->cpu[unsigned(value.bucket)];
            cpu.store(cpu.load(std::memory_order_relaxed) + value.nanoseconds,
                      std::memory_order_relaxed);
         }
      }
   };

   struct ScopeWasm : Scope
   {
      ScopeWasm() : Scope(Bucket::wasm) {}
   };
   struct ScopeNative : Scope
   {
      ScopeNative() : Scope(Bucket::native) {}
   };
   struct ScopeDb : Scope
   {
      ScopeDb() : Scope(Bucket::database) {}
   };
}  // namespace psibase::query_cpu_profile
