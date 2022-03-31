#pragma once

#include <eosio/check.hpp>
#include <psio/from_bin.hpp>

namespace psibase
{
   template <typename T>
   T unpack_all(psio::input_stream s, std::string_view error)
   {
      T result{};
      from_bin(result, s);
      eosio::check(error.empty() || !s.remaining(), error);
      return result;
   }
}  // namespace psibase
