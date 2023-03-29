#define OPENSSL_SUPPRESS_DEPRECATED

#include <psibase/crypto.hpp>

#include <openssl/sha.h>
#include <psibase/check.hpp>
#include <psio/from_bin.hpp>
#include <psio/psio_ripemd160.hpp>
#include <psio/to_bin.hpp>

namespace
{
   enum KeyType : uint8_t
   {
      k1 = 0,
      r1 = 1,
   };

   constexpr char base58Chars[] = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

   constexpr auto createBase58Map()
   {
      std::array<int8_t, 256> base58Map{{0}};
      for (unsigned i = 0; i < base58Map.size(); ++i)
         base58Map[i] = -1;
      for (unsigned i = 0; i < sizeof(base58Chars); ++i)
         base58Map[base58Chars[i]] = i;
      return base58Map;
   }

   constexpr auto base58Map = createBase58Map();

   template <typename Container>
   void base58ToBinary(Container& result, std::string_view s)
   {
      std::size_t offset = result.size();
      for (auto& src_digit : s)
      {
         int carry = base58Map[static_cast<uint8_t>(src_digit)];
         psibase::check(carry >= 0, "Invalid key or signature");
         for (std::size_t i = offset; i < result.size(); ++i)
         {
            auto& result_byte = result[i];
            int   x           = static_cast<uint8_t>(result_byte) * 58 + carry;
            result_byte       = x;
            carry             = x >> 8;
         }
         if (carry)
            result.push_back(static_cast<uint8_t>(carry));
      }
      for (auto& src_digit : s)
         if (src_digit == '1')
            result.push_back(0);
         else
            break;
      std::reverse(result.begin() + offset, result.end());
   }

   template <typename Container>
   std::string binaryToBase58(const Container& bin)
   {
      std::string result("");
      for (auto byte : bin)
      {
         static_assert(sizeof(byte) == 1);
         int carry = static_cast<uint8_t>(byte);
         for (auto& result_digit : result)
         {
            int x        = (base58Map[result_digit] << 8) + carry;
            result_digit = base58Chars[x % 58];
            carry        = x / 58;
         }
         while (carry)
         {
            result.push_back(base58Chars[carry % 58]);
            carry = carry / 58;
         }
      }
      for (auto byte : bin)
         if (byte)
            break;
         else
            result.push_back('1');
      std::reverse(result.begin(), result.end());
      return result;
   }

   template <typename... Container>
   std::array<unsigned char, 20> digestSuffixRipemd160(const Container&... data)
   {
      std::array<unsigned char, 20>   digest;
      psio_ripemd160::ripemd160_state self;
      psio_ripemd160::ripemd160_init(&self);
      (psio_ripemd160::ripemd160_update(&self, data.data(), data.size()), ...);
      psibase::check(psio_ripemd160::ripemd160_digest(&self, digest.data()),
                     "Invalid key or signature");
      return digest;
   }

   template <typename Key>
   Key stringToKey(std::string_view s, KeyType type, std::string_view suffix)
   {
      std::vector<char> whole;
      whole.push_back(uint8_t{type});
      base58ToBinary(whole, s);
      psibase::check(whole.size() > 5, "Invalid key or signature");
      auto ripe_digest =
          digestSuffixRipemd160(std::string_view(whole.data() + 1, whole.size() - 5), suffix);
      psibase::check(memcmp(ripe_digest.data(), whole.data() + whole.size() - 4, 4) == 0,
                     "Invalid key or signature");
      whole.erase(whole.end() - 4, whole.end());
      return psio::convert_from_bin<Key>(whole);
   }

   template <typename Key>
   std::string keyToString(const Key& key, std::string_view suffix, const char* prefix)
   {
      auto whole = psio::convert_to_bin(key);
      auto ripe_digest =
          digestSuffixRipemd160(std::string_view(whole.data() + 1, whole.size() - 1), suffix);
      whole.insert(whole.end(), ripe_digest.data(), ripe_digest.data() + 4);
      return prefix + binaryToBase58(std::string_view(whole.data() + 1, whole.size() - 1));
   }
}  // namespace

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

   std::string publicKeyToString(const PublicKey& key)
   {
      if (key.data.index() == KeyType::k1)
      {
         return keyToString(key, "K1", "PUB_K1_");
      }
      else if (key.data.index() == KeyType::r1)
      {
         return keyToString(key, "R1", "PUB_R1_");
      }
      else
      {
         check(false, "Expected public key");
         __builtin_unreachable();
      }
   }

   PublicKey publicKeyFromString(std::string_view s)
   {
      PublicKey result;
      // TODO: remove this case
      // if (s.substr(0, 3) == "EOS")
      // {
      //    return stringToKey<PublicKey>(s.substr(3), KeyType::k1, "");
      // }
      if (s.substr(0, 7) == "PUB_K1_")
      {
         return stringToKey<PublicKey>(s.substr(7), KeyType::k1, "K1");
      }
      else if (s.substr(0, 7) == "PUB_R1_")
      {
         return stringToKey<PublicKey>(s.substr(7), KeyType::r1, "R1");
      }
      else
      {
         check(false, "Expected public key");
         __builtin_unreachable();
      }
   }

   std::string privateKeyToString(const PrivateKey& private_key)
   {
      if (private_key.data.index() == KeyType::k1)
         return keyToString(private_key, "K1", "PVT_K1_");
      else if (private_key.data.index() == KeyType::r1)
         return keyToString(private_key, "R1", "PVT_R1_");
      else
      {
         check(false, "Expected private key");
         __builtin_unreachable();
      }
   }

   PrivateKey privateKeyFromString(std::string_view s)
   {
      if (s.substr(0, 7) == "PVT_K1_")
         return stringToKey<PrivateKey>(s.substr(7), KeyType::k1, "K1");
      else if (s.substr(0, 7) == "PVT_R1_")
         return stringToKey<PrivateKey>(s.substr(7), KeyType::r1, "R1");
      else if (s.substr(0, 4) == "PVT_")
      {
         check(false, "Expected private key");
         __builtin_unreachable();
      }
      else
      {
         std::vector<char> whole;
         base58ToBinary(whole, s);
         check(whole.size() >= 5, "Expected private key");
         whole[0] = KeyType::k1;
         whole.erase(whole.end() - 4, whole.end());
         return psio::convert_from_bin<PrivateKey>(whole);
      }
   }

   std::string signatureToString(const Signature& signature)
   {
      if (signature.data.index() == KeyType::k1)
         return keyToString(signature, "K1", "SIG_K1_");
      else if (signature.data.index() == KeyType::r1)
         return keyToString(signature, "R1", "SIG_R1_");
      else
      {
         check(false, "Expected signature");
         __builtin_unreachable();
      }
   }

   Signature signatureFromString(std::string_view s)
   {
      if (s.size() >= 7 && s.substr(0, 7) == "SIG_K1_")
         return stringToKey<Signature>(s.substr(7), KeyType::k1, "K1");
      else if (s.size() >= 7 && s.substr(0, 7) == "SIG_R1_")
         return stringToKey<Signature>(s.substr(7), KeyType::r1, "R1");
      else
      {
         check(false, "Expected signature");
         __builtin_unreachable();
      }
   }

   static Checksum256 merkle_combine(const Checksum256& lhs, const Checksum256& rhs)
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
         *(end - 2) = merkle_combine(*(end - 2), *(end - 1));
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
         result = merkle_combine(*--iter, result);
      }
      return result;
   }
}  // namespace psibase
