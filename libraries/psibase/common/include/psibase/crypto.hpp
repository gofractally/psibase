#pragma once

#include <eosio/fixed_bytes.hpp>  // TODO: replace fixed_bytes with simplified version
#include <eosio/to_bin.hpp>

#include <psio/fracpack.hpp>

namespace psibase
{
   using Checksum160 = std::array<uint32_t, 5>;
   using Checksum256 = std::array<uint64_t, 4>;
   using Checksum512 = std::array<uint64_t, 8>;

   Checksum256 sha256(const char* data, size_t length);

   inline Checksum256 sha256(const unsigned char* data, size_t length)
   {
      return sha256(reinterpret_cast<const char*>(data), length);
   }

   // TODO: remove; assumes a specific packing format
   template <typename T>
   Checksum256 sha256(const T& obj)
   {
      auto bin = psio::convert_to_frac(obj);  //eosio::convert_to_bin(obj);
      return sha256(bin.data(), bin.size());
   }
}  // namespace psibase
