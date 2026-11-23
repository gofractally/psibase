#include <psibase/QueryCpuProfile.hpp>

#include <cstdio>
#include <string_view>
#include <thread>
#include <vector>

namespace profile = psibase::query_cpu_profile;

namespace
{
   void require(bool value, const char* message)
   {
      if (!value)
         throw std::runtime_error(message);
   }

   void ledgerTest()
   {
      profile::ExclusiveLedger     ledger;
      std::array<std::uint64_t, 3> totals{};
      auto                         step = [&](profile::Bucket next, std::uint64_t now)
      {
         auto charge = ledger.transition(next, now);
         if (charge.bucket != profile::Bucket::none)
            totals[unsigned(charge.bucket)] += charge.nanoseconds;
      };
      using enum profile::Bucket;
      // Nested DB, same-bucket recursion, and host -> nested VM -> host.
      step(wasm, 10);
      step(native, 20);
      step(database, 30);
      step(database, 40);
      step(database, 50);
      step(native, 60);
      step(wasm, 70);
      step(wasm, 80);
      step(wasm, 90);
      step(native, 100);
      step(wasm, 110);
      step(native, 120);
      step(wasm, 130);
      step(native, 140);
      step(wasm, 150);
      step(none, 160);
      require(totals == std::array<std::uint64_t, 3>{70, 50, 30},
              "Nested CPU intervals overlap or charge the wrong bucket");
      step(database, 1'000);
      step(none, 1'010);
      require(totals[2] == 40, "Unscoped idle CPU was charged to DB");
   }

   void burnCpu()
   {
      const auto start = profile::threadCpu();
      while (profile::threadCpu() - start < 500'000)
         std::atomic_signal_fence(std::memory_order_seq_cst);
   }

   void realClockTest()
   {
      setenv("PSIBASE_QUERY_CPU_PROFILE", "1", 1);
      (void)profile::enabled();
      struct sigaction before{};
      sigaction(SIGUSR2, nullptr, &before);
      std::vector<std::thread> threads;
      for (unsigned i = 0; i < 2; ++i)
         threads.emplace_back(
             []
             {
                profile::ScopeWasm wasm;
                burnCpu();
                {
                   profile::ScopeNative host;
                   burnCpu();
                   {
                      profile::ScopeDb db;
                      burnCpu();
                   }
                   {
                      profile::ScopeWasm nested;
                      burnCpu();
                   }
                }
                try
                {
                   profile::ScopeNative host;
                   profile::ScopeDb     db;
                   throw std::runtime_error("Unwind nested scopes");
                }
                catch (const std::runtime_error&)
                {
                }
                require(profile::Scope::depth == 1 &&
                            profile::Scope::ledger.current == profile::Bucket::wasm,
                        "Exception unwinding did not restore the VM bucket");
             });
      for (auto& thread : threads)
         thread.join();
      auto&      s      = profile::state();
      const auto totals = profile::aggregate();
      require(s.active == 0, "Scopes remained active after thread exit");
      require(totals.calls[0] == 4 && totals.calls[1] == 4 && totals.calls[2] == 4,
              "Cross-thread scope counters were lost");
      require(totals.cpu[0] > 0 && totals.cpu[1] > 0 && totals.cpu[2] > 0, "A CPU bucket is empty");
      require(totals.cpu[0] + totals.cpu[1] + totals.cpu[2] <= profile::processCpu(),
              "Exclusive scoped CPU exceeds total process CPU");
      require(totals.clockErrors == 0 && s.processClockErrors == 0, "CPU clock failed");
      require(s.processStart != 0, "Cannot verify process start identity");
      raise(SIGUSR1);
      require(profile::requested == 1, "Signal did not request a checkpoint");
      {
         profile::ScopeWasm checkpoint;
      }
      require(profile::requested == 0 && s.sequence == 1,
              "Checkpoint did not run at the next safe scope boundary");
      struct sigaction after{};
      sigaction(SIGUSR2, nullptr, &after);
      require(before.sa_handler == after.sa_handler && before.sa_flags == after.sa_flags,
              "CPU profiler replaced the reserved Darwin CPU signal");
   }

   void partitionTest()
   {
      setenv("PSIBASE_QUERY_CPU_PROFILE", "1", 1);
      (void)profile::enabled();
      constexpr unsigned workers = 4, loops = 2'000;
      for (unsigned wave = 1; wave <= 2; ++wave)
      {
         std::vector<std::thread> threads;
         for (unsigned i = 0; i < workers; ++i)
            threads.emplace_back(
                []
                {
                   for (unsigned n = 0; n < loops; ++n)
                   {
                      profile::ScopeWasm   outer;
                      profile::ScopeNative host;
                      {
                         profile::ScopeDb db;
                         profile::ScopeDb recursiveDb;
                      }
                      profile::ScopeWasm nested;
                   }
                });
         for (auto& thread : threads)
            thread.join();
         const auto totals = profile::aggregate();
         require(profile::state().active == 0, "An exited worker retained an active root");
         require(totals.calls == std::array<std::uint64_t, 3>{wave * workers * loops * 2,
                                                              wave * workers * loops,
                                                              wave * workers * loops * 2},
                 "Per-thread aggregation lost calls or discarded an exited thread");
         auto& s = profile::state();
         require(s.threads.size() == wave * workers, "Thread records were reused or lost");
         for (const auto& record : s.threads)
         {
            require(reinterpret_cast<std::uintptr_t>(record.get()) % 128 == 0,
                    "Thread counters can share Apple cache lines");
            require(record->calls[0] == loops * 2 && record->calls[1] == loops &&
                        record->calls[2] == loops * 2,
                    "Thread counters were written by more than their owner");
         }
         require(totals.cpu[0] + totals.cpu[1] + totals.cpu[2] <= profile::processCpu() &&
                     totals.clockErrors == 0 && s.processClockErrors == 0,
                 "Partitioned CPU exceeded process CPU or a clock failed");
      }
   }

   void dummyHandler(int) {}
}  // namespace

int main(int argc, char** argv)
{
   try
   {
      unsetenv("PSIBASE_QUERY_CPU_PROFILE");
      unsetenv("PSIBASE_CALL_PROFILE");
      const std::string_view mode = argc > 1 ? argv[1] : "ledger";
      if (mode == "ledger")
         ledgerTest();
      else if (mode == "enabled")
         realClockTest();
      else if (mode == "partition")
         partitionTest();
      else if (mode == "disabled")
      {
         profile::ScopeWasm   wasm;
         profile::ScopeNative host;
         profile::ScopeDb     db;
         require(!profile::enabled() && profile::Scope::depth == 0,
                 "Disabled profiling entered its clock/accounting path");
      }
      else if (mode == "snapshot-active")
      {
         setenv("PSIBASE_QUERY_CPU_PROFILE", "1", 1);
         {
            profile::ScopeWasm active;
            raise(SIGUSR1);
            profile::checkpoint();
            require(profile::state().sequence == 0 && profile::requested == 1,
                    "An incomplete active interval was published");
         }
         require(profile::state().sequence == 1 && profile::requested == 0,
                 "Deferred checkpoint did not complete after the scope closed");
      }
      else if (mode == "conflict" || mode == "signal-owner" || mode == "unsupported")
      {
         setenv("PSIBASE_QUERY_CPU_PROFILE", "1", 1);
         if (mode == "conflict")
            setenv("PSIBASE_CALL_PROFILE", "1", 1);
         else if (mode == "signal-owner")
            std::signal(SIGUSR1, &dummyHandler);
         bool rejected = false;
         try
         {
            (void)profile::enabled();
         }
         catch (const std::runtime_error&)
         {
            rejected = true;
         }
         require(rejected, "Conflicting signal ownership was not rejected");
      }
      else
         throw std::runtime_error("Unknown test mode");
      std::puts("Query CPU profile check passed");
      return 0;
   }
   catch (const std::exception& error)
   {
      std::fprintf(stderr, "%s\n", error.what());
      return 1;
   }
}
