#include "services/system/PrivateKeyInfo.hpp"

#include <botan/auto_rng.h>
#include <botan/ber_dec.h>
#include <botan/der_enc.h>
#include <botan/pem.h>
#include <botan/pk_keys.h>
#include <botan/pkcs8.h>
#include <botan/pubkey.h>
#include <psibase/crypto.hpp>

namespace SystemService
{
   namespace AuthSig
   {
      std::vector<unsigned char> parsePrivateKeyInfo(std::string_view s)
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

      psibase::Signature sign(const PrivateKeyInfo&       private_key,
                              const psibase::Checksum256& checksum)
      {
         psibase::EccSignature signature = {};

         auto key = Botan::PKCS8::load_key({private_key.data.data(), private_key.data.size()});

         Botan::AutoSeeded_RNG rng;
         Botan::PK_Signer      signer(*key, rng, "Raw", Botan::Signature_Format::Standard);

         signer.update(checksum.data(), checksum.size());
         std::vector<uint8_t> s = signer.signature(rng);

         psibase::check(s.size() == 64, "Signing failed");

         std::copy(s.begin(), s.end(), signature.begin());

         return psibase::Signature{
             psibase::Signature::variant_type{psibase::Signature::r1, signature}};
      }

   }  // namespace AuthSig
}  // namespace SystemService