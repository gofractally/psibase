#pragma once

#include <psio/fracpack.hpp>

namespace psibase
{
   using Checksum160 = std::array<uint32_t, 5>;  // TODO: need uint8_t to signal json to use hex
   using Checksum256 = std::array<uint64_t, 4>;  // TODO: need uint8_t to signal json to use hex
   using Checksum512 = std::array<uint64_t, 8>;  // TODO: need uint8_t to signal json to use hex

   Checksum256 sha256(const char* data, size_t length);

   inline Checksum256 sha256(const unsigned char* data, size_t length)
   {
      return sha256(reinterpret_cast<const char*>(data), length);
   }

   template <typename T>
   Checksum256 sha256(const T& obj)
   {
      auto bin = psio::convert_to_frac(obj);
      return sha256(bin.data(), bin.size());
   }

   using EccPublicKey = std::array<uint8_t, 33>;
   using PublicKey    = std::variant<EccPublicKey, EccPublicKey>;  // k1, r1

   using EccPrivateKey = std::array<uint8_t, 32>;
   using PrivateKey    = std::variant<EccPrivateKey, EccPrivateKey>;  // k1, r1

   using EccSignature = std::array<uint8_t, 64>;
   using Signature    = std::variant<EccSignature, EccSignature>;  // k1, r1

   std::string publicKeyToString(const PublicKey& obj);
   PublicKey   publicKeyFromString(std::string_view s);
   std::string privateKeyToString(const PrivateKey& obj);
   PrivateKey  privateKeyFromString(std::string_view s);
   std::string signatureToString(const Signature& obj);
   Signature   signatureFromString(std::string_view s);

   template <typename S>
   void to_json(const PublicKey& obj, S& stream)
   {
      to_json(publicKeyToString(obj), stream);
   }
   template <typename S>
   void from_json(PublicKey& obj, S& stream)
   {
      auto s = stream.get_string();
      obj    = publicKeyFromString(s);
   }

   template <typename S>
   void to_json(const PrivateKey& obj, S& stream)
   {
      to_json(privateKeyToString(obj), stream);
   }
   template <typename S>
   void from_json(PrivateKey& obj, S& stream)
   {
      obj = privateKeyFromString(stream.get_string());
   }

   template <typename S>
   void to_json(const Signature& obj, S& stream)
   {
      return to_json(signatureToString(obj), stream);
   }
   template <typename S>
   void from_json(Signature& obj, S& stream)
   {
      obj = signatureFromString(stream.get_string());
   }

}  // namespace psibase
