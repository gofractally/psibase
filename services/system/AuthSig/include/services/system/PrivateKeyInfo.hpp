#pragma once
#include <psibase/Table.hpp>
#include <psibase/crypto.hpp>
#include <string>
#include <vector>

namespace SystemService
{
   namespace AuthSig
   {
      /// The private key type used by this library.
      /// It is encoded as a PKCS8 PrivateKeyInfo.
      struct PrivateKeyInfo
      {
         std::vector<unsigned char> data;

         friend bool operator==(const PrivateKeyInfo&, const PrivateKeyInfo&) = default;
         friend auto operator<=>(const PrivateKeyInfo& lhs, const PrivateKeyInfo& rhs)
         {
            return psibase::compare_wknd(lhs.data, rhs.data);
         };
      };
      // Takes a private key in PEM format encoded as a PKCS8 PrivateKeyInfo
      std::vector<unsigned char> parsePrivateKeyInfo(std::string_view s);
      std::string                to_string(const PrivateKeyInfo&);

      std::vector<uint8_t> sign(const PrivateKeyInfo&       private_key,
                                const psibase::Checksum256& checksum);

   }  // namespace AuthSig
}  // namespace SystemService