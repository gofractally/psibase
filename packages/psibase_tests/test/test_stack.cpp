#include <catch2/catch_all.hpp>
#include <psibase/DefaultTestChain.hpp>

#include <services/test/Recurse.hpp>

using namespace psibase;
using namespace TestService;

namespace
{
   // The test module's own recursion: runs `f` with `depth` of the test
   // module's frames above it on the native stack. Kept shallow by its
   // caller: a test module's own linear-memory stack is small.
   template <typename F>
   [[clang::noinline]] std::uint64_t below(std::uint64_t depth, F& f)
   {
      if (depth == 0)
      {
         f();
         return 0;
      }
      auto rest = below(depth - 1, f);
      return ((rest << 7) | (rest >> 57)) * 31 + depth;
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

   // It is the budget that ends it, not the native stack. Every call takes
   // at least 16 bytes of the budget, so this many levels cannot fit in it;
   // they are a few megabytes of native stack, of which wasmtime would let
   // the service have 128 MiB.
   const auto config =
       t.kvGet<WasmConfigRow>(WasmConfigRow::db, WasmConfigRow::key(transactionWasmConfigTable))
           .value_or(WasmConfigRow{});
   const std::uint64_t tooDeep = config.vmOptions.max_stack_bytes / 16 + 1;
   REQUIRE(tooDeep < 1'000'000);
   expect(push(tooDeep), overflow);

   // The failures left the chain and the tester usable.
   expect(push(101));

   // The same from deep inside the test module's own recursion.
   auto nested = [&]
   {
      expect(push(102));
      expect(push(~std::uint64_t(0)), overflow);
      expect(push(103));
   };
   CHECK(below(1'000, nested) != 0);
}
