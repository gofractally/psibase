#include <eosio/vm/signals.hpp>
#include <iostream>
#include <psibase/Watchdog.hpp>
using namespace psibase;
using namespace std::chrono_literals;
int main()
{
   eosio::vm::growable_allocator code;
   eosio::vm::wasm_allocator     memory;
   memory.reset(1);
   auto clock = accounting::currentThreadClock();
   for (unsigned i = 0; i < 50; ++i)
   {
      WatchdogManager manager;
      Watchdog        watchdog(manager, [] {});
      watchdog.setLimit(200ms);
      bool caught = false;
      eosio::vm::invoke_with_signal_handler(
          [&]
          {
             {
                std::thread sampler([&] { clock->read(); });
                sampler.join();
             }
             *memory.create_pointer<volatile char>(eosio::vm::page_size * 2) = 1;
          },
          [&](int signal) { caught = signal == SIGSEGV || signal == SIGBUS; }, code, &memory);
      if (!caught)
         throw std::runtime_error("VM memory trap handler changed");
      clock->read();
   }
   memory.free();
   std::cout << "50 actual EOS VM memory traps preserved with CPU sampler installed\n";
}
