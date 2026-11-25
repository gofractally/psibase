#pragma once

#include <psibase/AccountNumber.hpp>
#include <psibase/check.hpp>

#include <algorithm>
#include <cstddef>
#include <optional>
#include <span>

// Which service verifies signatures made with which kind of key.
//
// Each kind of key has its own verifier service. A claim for a key names the
// verifier for that key's kind, so everything that builds or checks a claim
// asks here instead of naming a service. This is the only place that knows
// the mapping; the verifier services recognize their keys with the same
// functions.

namespace psibase
{
   enum class KeyType
   {
      secp256k1,  // "K1"
      secp256r1,  // "R1", P-256
   };

   namespace verifier
   {
      /// The service that verifies secp256k1 signatures
      inline constexpr AccountNumber k1{"verify-k1"};
      /// The service that verifies secp256r1 (P-256) signatures
      inline constexpr AccountNumber r1{"verify-r1"};

      // AlgorithmIdentifier { id-ecPublicKey, namedCurve }
      inline constexpr unsigned char k1Algorithm[] = {0x30, 0x10, 0x06, 0x07, 0x2a, 0x86,
                                                      0x48, 0xce, 0x3d, 0x02, 0x01, 0x06,
                                                      0x05, 0x2b, 0x81, 0x04, 0x00, 0x0a};
      inline constexpr unsigned char r1Algorithm[] = {0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48,
                                                      0xce, 0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a,
                                                      0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07};

      constexpr std::span<const unsigned char> algorithm(KeyType type)
      {
         if (type == KeyType::secp256k1)
            return k1Algorithm;
         else
            return r1Algorithm;
      }

      /// If `spki` is exactly the DER SubjectPublicKeyInfo of a key of the
      /// given type, returns the encoded point; otherwise an empty span.
      ///
      /// The encoding is SEQUENCE { algorithm, BIT STRING point } with the
      /// fixed AlgorithmIdentifier of the curve and a point of 65 bytes
      /// (uncompressed, or the hybrid form that the verifiers go on to
      /// reject) or 33 bytes (compressed). Nothing else that a general DER
      /// parser would tolerate matches: no trailing bytes, no unused bits,
      /// no alternative identifier encodings. Whether the point is on the
      /// curve is not examined.
      constexpr std::span<const unsigned char> ecPoint(std::span<const unsigned char> spki,
                                                       KeyType                        type)
      {
         auto alg = algorithm(type);
         // outer SEQUENCE header, algorithm, BIT STRING header with zero unused bits
         const std::size_t header = 2 + alg.size() + 3;
         if (spki.size() != header + 65 && spki.size() != header + 33)
            return {};
         const std::size_t pointSize = spki.size() - header;
         if (spki[0] != 0x30 || spki[1] != spki.size() - 2)
            return {};
         if (!std::equal(alg.begin(), alg.end(), spki.begin() + 2))
            return {};
         auto bits = spki.subspan(2 + alg.size());
         if (bits[0] != 0x03 || bits[1] != pointSize + 1 || bits[2] != 0x00)
            return {};
         return spki.subspan(header);
      }
   }  // namespace verifier

   /// The type of the key whose DER SubjectPublicKeyInfo is `spki`, if a
   /// verifier exists for it and it is encoded as that verifier requires.
   constexpr std::optional<KeyType> keyType(std::span<const unsigned char> spki)
   {
      for (auto type : {KeyType::secp256k1, KeyType::secp256r1})
         if (!verifier::ecPoint(spki, type).empty())
            return type;
      return {};
   }

   /// The service that verifies signatures made with keys of this type
   constexpr AccountNumber verifierFor(KeyType type)
   {
      if (type == KeyType::secp256k1)
         return verifier::k1;
      else
         return verifier::r1;
   }

   /// The service that verifies signatures made with the key whose DER
   /// SubjectPublicKeyInfo is `spki`: the service a claim for this key must
   /// name. Nothing if no verifier accepts the key.
   constexpr std::optional<AccountNumber> verifierFor(std::span<const unsigned char> spki)
   {
      if (auto type = keyType(spki))
         return verifierFor(*type);
      return {};
   }
   inline std::optional<AccountNumber> verifierFor(std::span<const char> spki)
   {
      return verifierFor(std::span<const unsigned char>{
          reinterpret_cast<const unsigned char*>(spki.data()), spki.size()});
   }

   /// The verifier for a key that the caller is about to sign with or build
   /// a claim for. Aborts with "unsupported public key" if there is none.
   template <typename Byte>
   AccountNumber requireVerifierFor(std::span<Byte> spki)
   {
      auto result = verifierFor(std::span<const Byte>{spki});
      check(result.has_value(), "unsupported public key");
      return *result;
   }
   template <typename Bytes>
   AccountNumber requireVerifierFor(const Bytes& spki)
   {
      return requireVerifierFor(std::span{spki.data(), spki.size()});
   }

   /// The type of key that `service` verifies, if it is one of the verifiers
   constexpr std::optional<KeyType> verifiedKeyType(AccountNumber service)
   {
      for (auto type : {KeyType::secp256k1, KeyType::secp256r1})
         if (verifierFor(type) == service)
            return type;
      return {};
   }
}  // namespace psibase
