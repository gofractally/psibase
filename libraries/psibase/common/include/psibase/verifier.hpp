#pragma once

#include <psibase/AccountNumber.hpp>
#include <psibase/check.hpp>

#include <algorithm>
#include <cstddef>
#include <optional>
#include <span>

// Which services verify signatures made with which kind of key.
//
// Each verifier service handles one kind of key. A kind of key has a default
// verifier and may have others that an account can choose instead; a claim
// for a key names one of them. Everything that builds or checks a claim asks
// here instead of naming a service. This is the only place that knows the
// mapping; the verifier services recognize their keys with the same
// functions.
//
// - A claim on its own (a credential, a guest key) is acceptable if it names
//   any verifier allowed for its key: isAllowedVerifier.
// - A claim for an account must name the verifier the account stored with
//   its key (auth-sig). The default is verifierFor.

namespace psibase
{
   enum class KeyType
   {
      secp256k1,  // "K1"
      secp256r1,  // "R1", P-256
   };

   namespace verifier
   {
      /// Verifies secp256k1 signatures
      inline constexpr AccountNumber k1{"verify-k1"};
      /// Verifies secp256r1 (P-256) signatures. The default for that curve.
      inline constexpr AccountNumber r1{"verify-r1"};
      /// Verifies secp256r1 (P-256) signatures with a second, independent
      /// implementation. An account may choose it in place of the default.
      /// (BearSSL. "verify-bear1" would be two characters longer than an
      /// account name can be.)
      inline constexpr AccountNumber br1{"verify-br1"};
      static_assert(k1.value != 0 && r1.value != 0 && br1.value != 0,
                    "a verifier's name is not a valid account name");

      // The verifiers allowed for each key type, the default first.
      inline constexpr AccountNumber k1Verifiers[] = {k1};
      inline constexpr AccountNumber r1Verifiers[] = {r1, br1};

      /// n / 2 for each curve, where n is the group order: the largest s of
      /// a signature in the low-S form. Big-endian.
      inline constexpr unsigned char k1HalfOrder[32] = {
          0x7f, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
          0xff, 0xff, 0xff, 0xff, 0xff, 0x5d, 0x57, 0x6e, 0x73, 0x57, 0xa4,
          0x50, 0x1d, 0xdf, 0xe9, 0x2f, 0x46, 0x68, 0x1b, 0x20, 0xa0};
      inline constexpr unsigned char r1HalfOrder[32] = {
          0x7f, 0xff, 0xff, 0xff, 0x80, 0x00, 0x00, 0x00, 0x7f, 0xff, 0xff,
          0xff, 0xff, 0xff, 0xff, 0xff, 0xde, 0x73, 0x7d, 0x56, 0xd3, 0x8b,
          0xcf, 0x42, 0x79, 0xdc, 0xe5, 0x61, 0x7e, 0x31, 0x92, 0xa8};

      /// Whether the 64-byte signature r || s has s <= n/2 on this curve.
      /// (r, s) and (r, n - s) are both mathematically valid for the same
      /// message; only this one is accepted.
      constexpr bool isLowS(std::span<const unsigned char, 64> signature, KeyType type)
      {
         const unsigned char* half = type == KeyType::secp256k1 ? k1HalfOrder : r1HalfOrder;
         // Big-endian, so the first differing byte decides.
         for (std::size_t i = 0; i < 32; ++i)
            if (signature[32 + i] != half[i])
               return signature[32 + i] < half[i];
         return true;
      }

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

   /// The verifiers allowed for keys of this type, the default first
   constexpr std::span<const AccountNumber> allowedVerifiers(KeyType type)
   {
      if (type == KeyType::secp256k1)
         return verifier::k1Verifiers;
      else
         return verifier::r1Verifiers;
   }

   /// The default verifier for keys of this type
   constexpr AccountNumber verifierFor(KeyType type)
   {
      return allowedVerifiers(type)[0];
   }

   /// The default verifier for the key whose DER SubjectPublicKeyInfo is
   /// `spki`: the service a claim for this key names unless another allowed
   /// verifier was chosen for it. Nothing if no verifier accepts the key.
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

   /// The type of key that `service` verifies, if it is one of the verifiers
   constexpr std::optional<KeyType> verifiedKeyType(AccountNumber service)
   {
      for (auto type : {KeyType::secp256k1, KeyType::secp256r1})
         for (auto allowed : allowedVerifiers(type))
            if (allowed == service)
               return type;
      return {};
   }

   /// Whether `service` is one of the verifiers allowed for the key whose
   /// DER SubjectPublicKeyInfo is `spki`: whether a claim of `service` and
   /// this key is one that can be verified.
   constexpr bool isAllowedVerifier(AccountNumber service, std::span<const unsigned char> spki)
   {
      auto type = keyType(spki);
      return type && verifiedKeyType(service) == type;
   }
   inline bool isAllowedVerifier(AccountNumber service, std::span<const char> spki)
   {
      return isAllowedVerifier(service,
                               std::span<const unsigned char>{
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
}  // namespace psibase
