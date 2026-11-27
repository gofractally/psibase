#pragma once

#include <array>
#include <optional>
#include <span>
#include <string>
#include <string_view>

// A secp256k1 private key as one line of text: Bitcoin's wallet import
// format (WIF), the string that Bitcoin tools read and write.
//
//    base58( version || secret[32] || [0x01] || check[4] )
//
// - version is 0x80 (mainnet) or 0xEF (Bitcoin's test networks). The key is
//   the same number either way; the byte only says where the string came
//   from.
// - A trailing 0x01 says that the public key is used in its compressed form
//   (strings that start with K or L; c on a test network). Without it the
//   public key is the uncompressed point (5; 9 on a test network).
// - check is the first four bytes of SHA-256(SHA-256(everything before it)).
//
// This file is the definition. `rust/psibase/src/wif.rs`, common-lib's
// `wif.ts` and `psinode.py` mirror it with the same names and the same
// rules, and all four are tested against
// `libraries/psibase/common/tests/wif-vectors.json`.
//
// P-256 keys have no such form; they stay PEM.

namespace psibase
{
   /// The version byte of a WIF string
   enum class WifNetwork : unsigned char
   {
      mainnet = 0x80,
      testnet = 0xef,
   };

   /// What a WIF string holds
   struct WifKey
   {
      /// The private key, big-endian. 0 < secret < the group order.
      std::array<unsigned char, 32> secret;
      /// Whether the string asks for the compressed public key
      bool       compressed;
      WifNetwork network;
   };

   /// The first rule that a string breaks, in the order they are checked
   enum class WifError
   {
      /// A character outside the base58 alphabet, including white space
      /// anywhere but the ends
      badCharacter,
      /// Not 37 or 38 bytes
      badLength,
      /// The check bytes do not match: the string was mistyped
      badChecksum,
      /// A version byte other than 0x80 or 0xEF
      badVersion,
      /// A 34th payload byte other than 0x01
      badFlag,
      /// The key is 0 or is not below the secp256k1 group order
      badSecret,
   };

   /// "bad-character", "bad-length", "bad-checksum", "bad-version",
   /// "bad-flag", "bad-secret": the same names in every language
   std::string_view wifErrorName(WifError error);

   /// A sentence for the person who supplied the key
   std::string_view wifErrorMessage(WifError error);

   /// The WIF string of a private key. Aborts (check) if the key is 0 or
   /// is not below the group order.
   std::string wifEncode(std::span<const unsigned char, 32> secret,
                         bool                               compressed = true,
                         WifNetwork                         network    = WifNetwork::mainnet);

   /// Reads a WIF string. ASCII white space (space, tab, CR, LF) is ignored
   /// at the ends and is an error anywhere else. Returns nothing, and sets
   /// `*error` if it is given, when the string breaks one of the rules.
   /// Never aborts or throws.
   std::optional<WifKey> wifDecode(std::string_view text, WifError* error = nullptr) noexcept;

   /// Whether the text has the shape of a WIF string: 51 or 52 base58
   /// characters that start with 5, K, L, 9 or c, with optional white space
   /// around them. Cheap, and says nothing about whether the string is
   /// valid; it is for telling a key from a file name or a PEM document.
   bool looksLikeWif(std::string_view text) noexcept;
}  // namespace psibase
