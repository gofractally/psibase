#include <fcntl.h>
#include <unistd.h>
#include <atomic>
#include <future>
#include <iostream>
#include <psibase/Watchdog.hpp>
#include <thread>
#include <vector>
using namespace psibase;
using namespace std::chrono_literals;
void require(bool result, const char* message)
{
   if (!result)
      throw std::runtime_error(message);
}
volatile sig_atomic_t previousHandled = 0;
void                  previous(int)
{
   previousHandled = 1;
}
void block(bool value, sigset_t* previousMask = nullptr)
{
   sigset_t set;
   sigemptyset(&set);
   sigaddset(&set, SIGUSR2);
   require(pthread_sigmask(value ? SIG_BLOCK : SIG_UNBLOCK, &set, previousMask) == 0,
           "sigmask failed");
}
int main(int argc, char** argv)
{
   try
   {
      if (argc == 2 && std::string(argv[1]) == "previous")
      {
         struct sigaction action{};
         action.sa_handler = previous;
         sigemptyset(&action.sa_mask);
         require(sigaction(SIGUSR2, &action, nullptr) == 0, "previous install failed");
         bool rejected = false;
         try
         {
            accounting::currentThreadClock();
         }
         catch (const std::runtime_error&)
         {
            rejected = true;
         }
         require(rejected, "preexisting handler stolen");
         raise(SIGUSR2);
         require(previousHandled, "previous handler lost");
         std::cout << "previous handler preserved\n";
         return 0;
      }
      if (argc == 2 && std::string(argv[1]) == "blocked")
      {
         block(true);
         bool rejected = false;
         try
         {
            accounting::currentThreadClock();
         }
         catch (const std::runtime_error&)
         {
            rejected = true;
         }
         block(false);
         require(rejected, "blocked signal accepted");
         require(accounting::currentThreadClock()->read().count() > 0,
                 "retry after rejected capture failed");
         std::cout << "blocked signal rejected\n";
         return 0;
      }
      if (argc == 2 && std::string(argv[1]) == "replaced")
      {
         auto             clock = accounting::currentThreadClock();
         struct sigaction action{};
         action.sa_handler = previous;
         sigemptyset(&action.sa_mask);
         require(sigaction(SIGUSR2, &action, nullptr) == 0, "replacement install failed");
         bool        rejected = false;
         std::thread sampler(
             [&]
             {
                try
                {
                   clock->read();
                }
                catch (const std::runtime_error&)
                {
                   rejected = true;
                }
             });
         sampler.join();
         require(rejected, "replaced handler silently reclaimed");
         raise(SIGUSR2);
         require(previousHandled, "replacement handler stolen");
         std::cout << "replacement detected without reclaiming signal\n";
         return 0;
      }
      {
         std::promise<std::shared_ptr<accounting::NativeThreadClock>> promise;
         std::atomic<bool>                                            stop           = false;
         bool                                                         errnoPreserved = false;
         std::thread                                                  thread(
             [&]
             {
                std::vector<char> stack(128 * 1024);
                stack_t           alt{};
                alt.ss_sp   = stack.data();
                alt.ss_size = stack.size();
                require(sigaltstack(&alt, nullptr) == 0, "alt stack install failed");
                auto clock       = accounting::currentThreadClock();
                auto state       = clock->nativeState();
                state->stackLow  = std::uintptr_t(stack.data());
                state->stackHigh = std::uintptr_t(stack.data() + stack.size());
                promise.set_value(clock);
                errno                    = EDOM;
                std::uint64_t arithmetic = 1;
                while (!stop.load())
                {
                   for (unsigned i = 0; i < 1000; ++i)
                      arithmetic = arithmetic * 6364136223846793005ULL + 1;
                   std::atomic_signal_fence(std::memory_order_seq_cst);
                }
                errnoPreserved   = errno == EDOM;
                state->stackLow  = 0;
                state->stackHigh = 0;
                alt.ss_flags     = SS_DISABLE;
                require(sigaltstack(&alt, nullptr) == 0, "alt stack disable failed");
             });
         auto clock = promise.get_future().get();
         auto start = clock->read();
         while (clock->read() - start < 20ms)
         {
         }
         require(clock->nativeState()->usedAltStack.load(), "sampler did not use alternate stack");
         stop = true;
         thread.join();
         require(errnoPreserved, "handler changed errno");
         auto final = clock->read();
         require(final >= start + 20ms, "final owner CPU lost");
      }
      {
         std::promise<std::shared_ptr<accounting::NativeThreadClock>> promise;
         std::atomic<bool>                                            unblock = false;
         std::thread                                                  thread(
             [&]
             {
                auto clock = accounting::currentThreadClock();
                block(true);
                promise.set_value(clock);
                while (!unblock)
                   std::this_thread::sleep_for(50us);
                block(false);
             });
         auto clock  = promise.get_future().get();
         auto state  = clock->nativeState();
         auto first  = accounting::darwin::request(state);
         auto second = accounting::darwin::request(state);
         require(first == second, "inflight requests did not coalesce");
         unblock = true;
         thread.join();
         require(state->completed.load() == first, "pending generation lost at unblock/exit");
         require(state->handled.load() == 1, "coalesced generation handled more than once");
      }
      {
         auto     clock = accounting::currentThreadClock();
         sigset_t prior;
         block(true, &prior);
         {
            WatchdogManager manager;
            Watchdog        watchdog(manager, [] {});
            std::thread     requester([&] { accounting::darwin::request(clock->nativeState()); });
            requester.join();
         }
         require(pthread_sigmask(SIG_SETMASK, &prior, nullptr) == 0, "restore signal mask failed");
         raise(SIGUSR2);
         require(clock->read().count() > 0, "late signal after watchdog destruction failed");
      }
      {
         int pipefd[2];
         require(pipe(pipefd) == 0, "pipe failed");
         std::promise<std::shared_ptr<accounting::NativeThreadClock>> promise;
         int                                                          result = 0, error = 0;
         std::thread                                                  thread(
             [&]
             {
                auto clock = accounting::currentThreadClock();
                promise.set_value(clock);
                errno = EINVAL;
                char value;
                result = int(read(pipefd[0], &value, 1));
                error  = errno;
             });
         auto clock = promise.get_future().get();
         std::this_thread::sleep_for(2ms);
         clock->read();
         std::this_thread::sleep_for(2ms);
         require(write(pipefd[1], "x", 1) == 1, "pipe write failed");
         thread.join();
         close(pipefd[0]);
         close(pipefd[1]);
         require(result == 1 && error != EINTR, "SA_RESTART read interrupted");
      }
      for (unsigned i = 0; i < 200; ++i)
      {
         std::promise<std::shared_ptr<accounting::NativeThreadClock>> promise;
         std::atomic<bool>                                            leave = false;
         std::thread                                                  thread(
             [&]
             {
                auto clock = accounting::currentThreadClock();
                promise.set_value(clock);
                while (!leave)
                   std::atomic_signal_fence(std::memory_order_seq_cst);
             });
         auto clock = promise.get_future().get();
         leave      = true;
         clock->read();
         thread.join();
         require(clock->read().count() > 0, "retained exited-thread clock failed");
      }
      {
         std::promise<std::shared_ptr<accounting::NativeThreadClock>> promise;
         std::thread thread([&] { promise.set_value(accounting::currentThreadClock()); });
         auto        clock = promise.get_future().get();
         const auto  port  = clock->nativeState()->port;
         thread.join();
         mach_port_urefs_t references = 0;
         // pthread_join can complete a few microseconds before the kernel
         // destroys the Mach thread port. Wait for the real dead-name state.
         mach_port_type_t portType = 0;
         const auto       deadline = std::chrono::steady_clock::now() + 3s;
         do
         {
            require(mach_port_type(mach_task_self(), port, &portType) == KERN_SUCCESS,
                    "retained thread port disappeared before clock destruction");
            if (portType & MACH_PORT_TYPE_DEAD_NAME)
               break;
            std::this_thread::sleep_for(50us);
         } while (std::chrono::steady_clock::now() < deadline);
         require(mach_port_get_refs(mach_task_self(), port, MACH_PORT_RIGHT_DEAD_NAME,
                                    &references) == KERN_SUCCESS &&
                     references == 1,
                 "exited target clock did not own exactly its retained port right");
         clock.reset();
         require(mach_port_get_refs(mach_task_self(), port, MACH_PORT_RIGHT_DEAD_NAME,
                                    &references) == KERN_INVALID_NAME,
                 "final retained target clock leaked its port right");
      }
      {
         // A delayed/blocked signal cannot freeze live CPU accounting: bounded
         // sampling waits fall back to actual Mach thread CPU, retaining the
         // maximum observed count until precise self sampling resumes.
         std::promise<std::shared_ptr<accounting::NativeThreadClock>> promise;
         std::atomic<bool>                                            stop = false;
         std::jthread                                                 thread(
             [&]
             {
                auto clock = accounting::currentThreadClock();
                block(true);
                promise.set_value(clock);
                while (!stop.load())
                   std::atomic_signal_fence(std::memory_order_seq_cst);
                block(false);
             });
         auto       clock = promise.get_future().get();
         auto       start = clock->read(), previous = start;
         const auto deadline = std::chrono::steady_clock::now() + 3s;
         while (previous - start < 20ms && std::chrono::steady_clock::now() < deadline)
         {
            const auto next = clock->read();
            require(next >= previous, "fallback erased previously observed CPU");
            previous = next;
         }
         stop = true;
         thread.join();
         require(previous - start >= 20ms, "signal timeout concealed unlimited active CPU");
         require(clock->read() >= previous, "precise sampling reset fallback CPU debt");
      }
      {
         std::promise<std::shared_ptr<accounting::NativeThreadClock>> promise;
         std::atomic<bool> proceed = false, ioDone = false, release = false;
         char              filename[] = "/tmp/psibase-signal-commit-XXXXXX";
         const auto        fd         = mkstemp(filename);
         require(fd >= 0, "temporary commit file failed");
         bool        success = false;
         std::thread thread(
             [&]
             {
                auto clock = accounting::currentThreadClock();
                {
                   accounting::PublicationSignalMask mask;
                   promise.set_value(clock);
                   while (!proceed)
                      std::this_thread::sleep_for(50us);
                   success = true;
                   for (unsigned i = 0; i < 100; ++i)
                      if (write(fd, "commit\n", 7) != 7 || fsync(fd))
                         success = false;
                   ioDone = true;
                   while (!release)
                      std::this_thread::sleep_for(50us);
                }
             });
         auto       clock      = promise.get_future().get();
         const auto generation = accounting::darwin::request(clock->nativeState());
         proceed               = true;
         while (!ioDone)
            std::this_thread::sleep_for(100us);
         require(clock->nativeState()->completed.load() < generation,
                 "publication mask did not defer sampling signal");
         release = true;
         thread.join();
         close(fd);
         require(success, "accepted fsync/write interrupted");
         require(clock->nativeState()->completed.load() == generation,
                 "sampling signal lost after accepted I/O");
      }
      std::cout << "{\"passed\":true,\"exit_races\":200,\"alt_stack\":true,\"errno_preserved\":"
                   "true,\"restart_read\":true,\"late_signal_safe\":true,\"coalesced_generation\":"
                   "true,\"accepted_io_mask\":true}\n";
   }
   catch (const std::exception& e)
   {
      std::cerr << e.what() << '\n';
      return 1;
   }
}
