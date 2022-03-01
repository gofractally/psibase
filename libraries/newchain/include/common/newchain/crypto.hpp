#pragma once

#include <eosio/fixed_bytes.hpp>  // TODO: replace fixed_bytes with simplified version
#include <eosio/to_bin.hpp>

namespace newchain
{
   eosio::checksum256 sha256(const char* data, uint32_t length);

   inline eosio::checksum256 sha256(const unsigned char* data, uint32_t length)
   {
      return sha256(reinterpret_cast<const char*>(data), length);
   }

   template <typename T>
   eosio::checksum256 sha256(const T& obj)
   {
      auto bin = eosio::convert_to_bin(obj);
      return sha256(bin.data(), bin.size());
   }
}  // namespace newchain
