#include <newchain/crypto.hpp>

#include <openssl/sha.h>

// TODO: decide which, if any, crypto ops to make into intrinsics

namespace newchain
{
   eosio::checksum256 sha256(const char* data, uint32_t length)
   {
      std::array<unsigned char, 256 / 8> result;
      SHA256((const unsigned char*)data, length, result.data());
      return result;
   }
}  // namespace newchain
