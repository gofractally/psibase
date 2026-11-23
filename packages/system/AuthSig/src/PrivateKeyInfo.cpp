#include "services/system/PrivateKeyInfo.hpp"
#include "services/system/Spki.hpp"

#include <botan/auto_rng.h>
#include <botan/ber_dec.h>
#include <botan/bigint.h>
#include <botan/der_enc.h>
#include <botan/ecc_key.h>
#include <botan/entropy_src.h>
#include <botan/pem.h>
#include <botan/pk_algs.h>
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

      SubjectPublicKeyInfo getSubjectPublicKeyInfo(const PrivateKeyInfo& private_key)
      {
         auto key = Botan::PKCS8::load_key({private_key.data.data(), private_key.data.size()});
         return {key->subject_public_key()};
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

         // verify-sig only accepts the low-S form: s <= n/2.
         auto ec = dynamic_cast<const Botan::EC_PrivateKey*>(key.get());
         psibase::check(ec != nullptr, "Not an elliptic curve key");
         const Botan::BigInt& order = ec->domain().get_order();
         Botan::BigInt        sValue(msg.data() + 32, 32);
         if (sValue > order / 2)
            Botan::BigInt::encode_1363(msg.data() + 32, 32, order - sValue);

         return msg;
      }

      PrivateKeyInfo PrivateKeyInfo::create(std::string_view group)
      {
         auto sources = Botan::Entropy_Sources();
         sources.add_source(Botan::Entropy_Source::create("getentropy"));
         Botan::AutoSeeded_RNG rng(sources);

         auto key    = Botan::create_private_key("ECDSA", rng, group);
         auto result = Botan::PKCS8::BER_encode(*key);
         return PrivateKeyInfo{.data{result.begin(), result.end()}};
      }

   }  // namespace AuthSig
}  // namespace SystemService
