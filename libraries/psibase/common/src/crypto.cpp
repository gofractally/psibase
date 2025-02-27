#define OPENSSL_SUPPRESS_DEPRECATED

#include <psibase/crypto.hpp>

#include <openssl/sha.h>
#include <psibase/check.hpp>
#include <psio/from_bin.hpp>
#include <psio/psio_ripemd160.hpp>
#include <psio/to_bin.hpp>

namespace psibase
{
   Checksum256 sha256(const char* data, size_t length)
   {
      //std::array<unsigned char, 256 / 8> result;
      SHA256_CTX ctx;
      SHA256_Init(&ctx);
      SHA256_Update(&ctx, (const unsigned char*)data, length);
      Checksum256 result;
      SHA256_Final((unsigned char*)result.data(), &ctx);
      return result;
   }

   // RFC 2104
   Checksum256 hmacSha256(const char* key,
                          std::size_t keyLen,
                          const char* data,
                          std::size_t dataLen)
   {
      constexpr std::size_t B                             = 64;
      unsigned char         buf[B + Checksum256{}.size()] = {};
      SHA256_CTX            ctx;
      SHA256_Init(&ctx);
      // pad or hash key
      if (keyLen <= B)
      {
         std::memcpy(buf, key, keyLen);
      }
      else
      {
         Checksum256 hashedKey = sha256(key, keyLen);
         std::memcpy(buf, hashedKey.data(), hashedKey.size());
      }
      // K ^ ipad
      for (std::size_t i = 0; i < B; ++i)
      {
         buf[i] ^= 0x36;
      }
      SHA256_Update(&ctx, buf, B);
      SHA256_Update(&ctx, reinterpret_cast<const unsigned char*>(data), dataLen);
      SHA256_Final(buf + B, &ctx);
      // K ^ opad
      for (std::size_t i = 0; i < B; ++i)
      {
         buf[i] ^= 0x36 ^ 0x5c;
      }
      SHA256_Init(&ctx);
      SHA256_Update(&ctx, buf, sizeof(buf));
      Checksum256 result;
      SHA256_Final(result.data(), &ctx);
      return result;
   }

   Checksum256 hmacSha256(std::span<const char> key, std::span<const char> data)
   {
      return hmacSha256(key.data(), key.size(), data.data(), data.size());
   }

   Checksum256 Merkle::combine(const Checksum256& lhs, const Checksum256& rhs)
   {
      char buf[1 + lhs.size() + rhs.size()];
      buf[0]   = '\1';
      auto pos = buf + 1;
      std::memcpy(pos, lhs.data(), lhs.size());
      pos += lhs.size();
      std::memcpy(pos, rhs.data(), rhs.size());
      return sha256(buf, sizeof(buf));
   }

   void Merkle::push_impl(const Checksum256& value)
   {
      stack.push_back(value);
      for (std::uint64_t x = i; (x & 1) != 0; x >>= 1)
      {
         auto end   = stack.end();
         *(end - 2) = combine(*(end - 2), *(end - 1));
         stack.pop_back();
      }
      ++i;
   }

   Checksum256 Merkle::root() const
   {
      if (stack.empty())
         return Checksum256{};
      auto        iter   = stack.end();
      auto        begin  = stack.begin();
      Checksum256 result = *--iter;
      while (iter != begin)
      {
         result = combine(*--iter, result);
      }
      return result;
   }
}  // namespace psibase
