#include "services/system/PrivateKeyInfo.hpp"
#include "services/system/Spki.hpp"

#include <botan/auto_rng.h>
#include <botan/bigint.h>
#include <botan/ec_group.h>
#include <botan/ecc_key.h>
#include <botan/entropy_src.h>
#include <botan/pk_algs.h>
#include <botan/pk_keys.h>
#include <botan/pkcs8.h>
#include <botan/pubkey.h>
#include <psibase/check.hpp>
#include <psibase/pem.hpp>

namespace SystemService
{
   namespace AuthSig
   {
      std::vector<unsigned char> parsePrivateKeyInfo(std::string_view s)
      {
         auto der = psibase::pemDecode(s, "PRIVATE KEY");
         psibase::check(der.has_value(), "Pem->PrivateKeyInfo: Expected a PEM encoded PRIVATE KEY");

         // Aborts unless it is a key that can be used
         std::unique_ptr<Botan::Private_Key> privateKey = Botan::PKCS8::load_key(*der);

         return std::move(*der);
      }
      std::string to_string(const PrivateKeyInfo& key)
      {
         return psibase::pemEncode(key.data, "PRIVATE KEY");
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

         // The verifiers only accept the low-S form: s <= n/2.
         auto ec = dynamic_cast<const Botan::EC_PrivateKey*>(key.get());
         psibase::check(ec != nullptr, "Not an elliptic curve key");
         const Botan::BigInt& order = ec->domain().get_order();
         std::span<std::uint8_t> s{msg.data() + 32, 32};
         Botan::BigInt           sValue = Botan::BigInt::from_bytes(s);
         if (sValue > order / 2)
            (order - sValue).serialize_to(s);

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
