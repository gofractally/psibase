#include <services/test/Recurse.hpp>

#include <psibase/dispatch.hpp>

using namespace TestService;

namespace
{
   // Not a tail call, and every level keeps a buffer live across the call
   // below it, so no compiler turns this into a loop.
   [[clang::noinline]] std::uint64_t level(std::uint64_t depth, std::uint64_t limit)
   {
      volatile char frame[Recurse::frameBytes];
      frame[depth % sizeof(frame)] = static_cast<char>(depth);
      if (depth == limit)
         return frame[depth % sizeof(frame)];
      return level(depth + 1, limit) + frame[depth % sizeof(frame)];
   }
}  // namespace

std::uint64_t Recurse::descend(std::uint64_t limit)
{
   return level(0, limit);
}

PSIBASE_DISPATCH(Recurse)
