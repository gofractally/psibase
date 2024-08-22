#include "services/system/Spki.hpp"

#include <botan/ber_dec.h>
#include <botan/der_enc.h>
#include <botan/pem.h>
#include <botan/x509_key.h>
#include <psibase/crypto.hpp>

namespace SystemService
{
   namespace AuthSig
   {
      bool SubjectPublicKeyInfo::validate(const std::vector<unsigned char>& data)
      {
         Botan::X509::load_key({data.data(), data.size()});  // Throws if decoding fails
         return true;
      }

      std::vector<unsigned char> parseSubjectPublicKeyInfoFromPem(std::string_view s)
      {
         Botan::AlgorithmIdentifier algorithm;
         std::vector<std::uint8_t>  key;

         std::string label_got;
         auto        ber = Botan::PEM_Code::decode(s, label_got);
         if (label_got != "PUBLIC KEY")
         {
            psibase::check(false,
                           "Pem->SPKI: Expected label \"PUBLIC KEY\", got label: " + label_got);
         }

         Botan::BER_Decoder(ber)
             .start_sequence()
             .decode(algorithm)
             .decode(key, Botan::ASN1_Type::BitString)
             .end_cons();
         return std::vector<unsigned char>(ber.begin(), ber.end());
      }

      std::vector<unsigned char> parseSubjectPublicKeyInfo(std::string_view s)
      {
         if (s.starts_with("-----BEGIN"))
         {
            return parseSubjectPublicKeyInfoFromPem(s);
         }
         else
         {
            psibase::abortMessage("Expected public key");
         }
      }

      std::string to_string(const SubjectPublicKeyInfo& key)
      {
         return Botan::PEM_Code::encode(reinterpret_cast<const std::uint8_t*>(key.data.data()),
                                        key.data.size(), "PUBLIC KEY");
      }

      std::string keyFingerprint(const SubjectPublicKeyInfo& key)
      {
         const char* xdigits = "0123456789abcdef";
         auto        hash    = psibase::sha256(key.data.data(), key.data.size());
         std::string result;
         bool        first = true;
         for (unsigned char ch : hash)
         {
            if (first)
               first = false;
            else
               result += ':';
            result += xdigits[ch & 0xF];
            result += xdigits[(ch >> 4) & 0xF];
         }
         return result;
      }
   }  // namespace AuthSig
}  // namespace SystemService