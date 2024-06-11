#include "services/system/PrivateKeyInfo.hpp"

#include <botan/ber_dec.h>
#include <botan/der_enc.h>
#include <botan/pem.h>
#include <botan/pkcs8.h>
#include <psibase/crypto.hpp>

namespace SystemService
{
   namespace AuthSig
   {
      std::vector<unsigned char> parsePrivateKeyInfoFromPem(std::string_view s)
      {
         Botan::AlgorithmIdentifier algorithm;
         std::vector<std::uint8_t>  key;

         std::string label_got;
         auto        ber = Botan::PEM_Code::decode(s, label_got);
         if (label_got != "PRIVATE KEY")
         {
            psibase::check(
                false,
                "Pem->PrivateKeyInfo: Expected label \"PRIVATE KEY\", got label: " + label_got);
         }

         std::unique_ptr<Botan::Private_Key> privateKey = Botan::PKCS8::load_key(ber);

         return std::vector<unsigned char>(ber.begin(), ber.end());
      }
      std::string to_string(const PrivateKeyInfo& key)
      {
         return Botan::PEM_Code::encode(reinterpret_cast<const std::uint8_t*>(key.data.data()),
                                        key.data.size(), "PRIVATE KEY");
      }
   }  // namespace AuthSig
}  // namespace SystemService