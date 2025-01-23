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
