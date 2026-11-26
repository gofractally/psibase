#include <catch2/catch_all.hpp>
#include <psibase/DefaultTestChain.hpp>

#include <services/test/Recurse.hpp>

using namespace psibase;
using namespace TestService;

namespace
{
   // The test module's own recursion: runs `f` with `depth` of the test
   // module's frames above it on the native stack.
   template <typename F>
   [[clang::noinline]] std::uint64_t below(std::uint32_t depth, F& f)
   {
      volatile char frame[256];
      frame[depth % sizeof(frame)] = static_cast<char>(depth);
      if (depth == 0)
      {
         f();
         return frame[0];
      }
      return below(depth - 1, f) + frame[depth % sizeof(frame)];
   }
}  // namespace

// A service the test module calls runs on the test module's native stack,
// below the module's own frames. What stops a service that recurses too deep
// must still be the chain's stack budget (max_stack_bytes), as on a node: an
// ordinary failed action, with the tester and the chain intact.
TEST_CASE("A service that recurses without bound fails by the stack budget")
{
   DefaultTestChain t;
   t.addService(Recurse::service, "Recurse.wasm");
   transactor<Recurse> recurse{Recurse::service, Recurse::service};

   auto push = [&](std::uint64_t limit)
   { return t.pushTransaction(t.makeTransaction({recurse.descend(limit)})); };
   const std::string overflow = "stack overflow";

   // The service runs.
   expect(push(100));

   // Without bound.
   expect(push(~std::uint64_t(0)), overflow);

   // It is the budget that ends it, not the native stack: 20,000 levels need
   // at least 5 MB of the 1 MiB budget, and far less than the native stack
   // wasmtime would let the service have (128 MiB).
   const WasmConfigRow config =
       t.kvGet<WasmConfigRow>(WasmConfigRow::db, WasmConfigRow::key(transactionWasmConfigTable))
           .value_or(WasmConfigRow{});
   REQUIRE(std::uint64_t(20'000) * Recurse::frameBytes > config.vmOptions.max_stack_bytes);
   expect(push(20'000), overflow);

   // The failures left the chain and the tester usable.
   expect(push(100));

   // The same from deep inside the test module's own recursion.
   auto nested = [&]
   {
      expect(push(100));
      expect(push(~std::uint64_t(0)), overflow);
      expect(push(100));
   };
   below(20'000, nested);
}
