#pragma once
#include <psibase/Table.hpp>
#include <psibase/crypto.hpp>
#include <string>
#include <vector>

namespace SystemService
{
   namespace AuthSig
   {
      struct SubjectPublicKeyInfo;

      /// The private key type used by this library.
      /// It is encoded as a PKCS8 PrivateKeyInfo.
      struct PrivateKeyInfo
      {
         std::vector<unsigned char> data;

         /// Creates a new key held in software. secp256k1 verifies several times
         /// faster than secp256r1 (P-256); pass "secp256r1" for a key that has to
         /// match one held by hardware.
         static PrivateKeyInfo create(std::string_view group = "secp256k1");

         friend bool operator==(const PrivateKeyInfo&, const PrivateKeyInfo&) = default;
         friend auto operator<=>(const PrivateKeyInfo& lhs, const PrivateKeyInfo& rhs)
         {
            return psibase::compare_wknd(lhs.data, rhs.data);
         };
      };
      // Takes a private key in PEM format encoded as a PKCS8 PrivateKeyInfo
      std::vector<unsigned char> parsePrivateKeyInfo(std::string_view s);
      std::string                to_string(const PrivateKeyInfo&);
      SubjectPublicKeyInfo       getSubjectPublicKeyInfo(const PrivateKeyInfo& private_key);

      inline std::vector<unsigned char>& psio_unwrap_packable(PrivateKeyInfo& obj)
      {
         return obj.data;
      }
      inline const std::vector<unsigned char>& psio_unwrap_packable(const PrivateKeyInfo& obj)
      {
         return obj.data;
      }

      std::vector<uint8_t> sign(const PrivateKeyInfo&       private_key,
                                const psibase::Checksum256& checksum);

   }  // namespace AuthSig
}  // namespace SystemService
