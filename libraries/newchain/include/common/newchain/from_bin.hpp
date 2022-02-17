#pragma once

#include <eosio/from_bin.hpp>

namespace newchain
{
   template <typename T>
   T unpack_all(eosio::input_stream s, std::string_view error)
   {
      T result{};
      from_bin(result, s);
      eosio::check(error.empty() || !s.remaining(), error);
      return result;
   }
}  // namespace newchain
