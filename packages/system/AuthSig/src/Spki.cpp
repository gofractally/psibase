#include "services/system/Spki.hpp"

#include <psibase/check.hpp>
#include <psibase/crypto.hpp>
#include <psibase/pem.hpp>

namespace SystemService
{
   namespace AuthSig
   {
      bool SubjectPublicKeyInfo::validate(const std::vector<unsigned char>& data)
      {
         return psibase::hasSubjectPublicKeyInfoShape(data);
      }

      std::vector<unsigned char> parseSubjectPublicKeyInfoFromPem(std::string_view s)
      {
         auto der = psibase::pemDecode(s, "PUBLIC KEY");
         psibase::check(der.has_value(), "Pem->SPKI: Expected a PEM encoded PUBLIC KEY");
         psibase::check(SubjectPublicKeyInfo::validate(*der),
                        "Pem->SPKI: not a SubjectPublicKeyInfo");
         return std::move(*der);
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
         return psibase::pemEncode(key.data, "PUBLIC KEY");
      }

      psibase::Checksum256 keyFingerprint(const SubjectPublicKeyInfo& key)
      {
         return psibase::sha256(key.data.data(), key.data.size());
      }

      psibase::Checksum256 SubjectPublicKeyInfo::fingerprint() const
      {
         return psibase::sha256(data.data(), data.size());
      }
   }  // namespace AuthSig
}  // namespace SystemService
