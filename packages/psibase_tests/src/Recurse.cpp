#include <services/test/Recurse.hpp>

#include <psibase/dispatch.hpp>

using namespace TestService;

namespace
{
   // Not a tail call, and the result is not an accumulation a compiler can
   // turn into a loop. Nothing here has its address taken, so a level uses
   // the wasm call stack only, not the service's linear memory.
   [[clang::noinline]] std::uint64_t level(std::uint64_t depth, std::uint64_t limit)
   {
      if (depth == limit)
         return depth;
      auto below = level(depth + 1, limit);
      return ((below << 7) | (below >> 57)) * 31 + depth;
   }
}  // namespace

std::uint64_t Recurse::descend(std::uint64_t limit)
{
   return level(0, limit);
}

PSIBASE_DISPATCH(Recurse)
