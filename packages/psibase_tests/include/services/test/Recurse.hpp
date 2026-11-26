#pragma once

#include <cstdint>
#include <psibase/Service.hpp>

namespace TestService
{
   // Calls itself `limit` deep; with the largest limit, without bound.
   struct Recurse : psibase::Service
   {
      static constexpr auto service = psibase::AccountNumber{"recurse"};
      // Bytes of stack every level keeps live.
      static constexpr std::uint32_t frameBytes = 256;
      std::uint64_t                  descend(std::uint64_t limit);
   };
   PSIO_REFLECT(Recurse, method(descend, limit))
}  // namespace TestService
