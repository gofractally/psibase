#pragma once

#include <eosio/fixed_bytes.hpp>  // TODO: replace fixed_bytes with simplified version
#include <eosio/to_bin.hpp>

namespace newchain
{
   eosio::checksum256 sha256(const char* data, uint32_t length);

   template <typename T>
   eosio::checksum256 sha256(const T& obj)
   {
      auto bin = eosio::convert_to_bin(obj);
      return sha256(bin.data(), bin.size());
   }
}  // namespace newchain
