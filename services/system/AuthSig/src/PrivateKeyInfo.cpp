#include "services/system/PrivateKeyInfo.hpp"

#include <botan/auto_rng.h>
#include <botan/ber_dec.h>
#include <botan/der_enc.h>
#include <botan/entropy_src.h>
#include <botan/pem.h>
#include <botan/pk_keys.h>
#include <botan/pkcs8.h>
#include <botan/pubkey.h>

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

      std::vector<uint8_t> sign(const PrivateKeyInfo&       private_key,
                                const psibase::Checksum256& checksum)
      {
         auto key = Botan::PKCS8::load_key({private_key.data.data(), private_key.data.size()});

         auto sources = Botan::Entropy_Sources();
         sources.add_source(Botan::Entropy_Source::create("getentropy"));
         Botan::AutoSeeded_RNG rng(sources);

         Botan::PK_Signer     signer(*key, rng, "Raw", Botan::Signature_Format::Standard);
         std::vector<uint8_t> msg = signer.sign_message({checksum.data(), checksum.size()}, rng);

         psibase::check(msg.size() == 64, "Signing failed");

         return msg;
      }

   }  // namespace AuthSig
}  // namespace SystemService