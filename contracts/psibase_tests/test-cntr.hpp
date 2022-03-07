#pragma once

#include <stdint.h>
#include <eosio/reflection.hpp>
#include <string>

namespace test_cntr
{
   struct payload
   {
      int         number;
      std::string memo;
   };
   EOSIO_REFLECT(payload, number, memo)
}  // namespace test_cntr
