#pragma once

#include <stdint.h>
#include <psio/fracpack.hpp>
#include <string>

namespace test_cntr
{
   struct payload
   {
      int         number;
      std::string memo;
   };
   PSIO_REFLECT(payload, number, memo)
}  // namespace test_cntr
