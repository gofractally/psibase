#pragma once

#include <stdint.h>
#include <eosio/reflection.hpp>
#include <string>

struct payload
{
   int         number;
   std::string memo;
};
EOSIO_REFLECT(payload, number, memo)
