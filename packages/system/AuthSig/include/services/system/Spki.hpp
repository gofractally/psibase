#pragma once
#include <psibase/Table.hpp>
#include <psibase/pem.hpp>
#include <psio/adapter.hpp>
#include <string>
#include <vector>

namespace SystemService
{
   namespace AuthSig
   {
      /// The public key type used by this library.
      /// It is encoded as an X.509 SubjectPublicKeyInfo.
      ///
      /// Wherever it is packed it is its DER bytes (`transparent()`); the
      /// bytes are not parsed when a key is unpacked. `validate` checks
      /// their structure; an action that stores a key calls it.
      struct SubjectPublicKeyInfo
      {
         std::vector<unsigned char> data;

         static bool validate(const std::vector<unsigned char>& data);

         friend bool operator==(const SubjectPublicKeyInfo&, const SubjectPublicKeyInfo&) = default;
         friend auto operator<=>(const SubjectPublicKeyInfo& lhs, const SubjectPublicKeyInfo& rhs)
         {
            return psibase::compare_wknd(lhs.data, rhs.data);
         }

         psibase::Checksum256 fingerprint() const;
         PSIO_REFLECT(SubjectPublicKeyInfo, transparent(), data)
      };

      PSIBASE_REFLECT_KEY_TRANSFORM(&SubjectPublicKeyInfo::fingerprint, "sha256-key-fingerprint")

      // Takes a public key as a PEM encoded X.509 SubjectPublicKeyInfo
      // Returns a DER encoded SubjectPublicKeyInfo
      std::vector<unsigned char> parseSubjectPublicKeyInfo(std::string_view);
      std::string                to_string(const SubjectPublicKeyInfo&);

      /// The text form of a `SubjectPublicKeyInfo`, which is its JSON: the
      /// PEM armor of the DER bytes, `-----BEGIN PUBLIC KEY-----` …
      /// `-----END PUBLIC KEY-----`.
      ///
      /// A text is accepted when it is that armor around valid base64 and
      /// the bytes have the outer shape of a SubjectPublicKeyInfo
      /// (`psibase::hasSubjectPublicKeyInfoShape`). The algorithm and the
      /// key material are not examined here: an action that stores a key
      /// calls `SubjectPublicKeyInfo::validate`.
      struct SubjectPublicKeyInfoText
      {
         static constexpr std::string_view schema_id = "SubjectPublicKeyInfo";
         static constexpr std::string_view label     = "PUBLIC KEY";

         static std::string text(const SubjectPublicKeyInfo& key)
         {
            return psibase::pemEncode(key.data, label);
         }
         static std::size_t packsize(const SubjectPublicKeyInfo& key) { return text(key).size(); }
         static void encode(const SubjectPublicKeyInfo& key, std::string& out) { out += text(key); }
         static SubjectPublicKeyInfo decode(std::span<const char> text)
         {
            return SubjectPublicKeyInfo{
                psibase::pemDecode(std::string_view{text.data(), text.size()}, label).value()};
         }
         static psio::codec_status validate(std::span<const char> text) noexcept
         {
            auto der = psibase::pemDecode(std::string_view{text.data(), text.size()}, label);
            if (!der)
               return psio::codec_fail("SubjectPublicKeyInfo: not a PEM encoded public key", 0,
                                       "SubjectPublicKeyInfo");
            if (!psibase::hasSubjectPublicKeyInfoShape(*der))
               return psio::codec_fail(
                   "SubjectPublicKeyInfo: the PEM content is not a SubjectPublicKeyInfo", 0,
                   "SubjectPublicKeyInfo");
            return psio::codec_ok();
         }
         static psio::codec_status validate_strict(std::span<const char> text) noexcept
         {
            return validate(text);
         }
      };

      psibase::Checksum256 keyFingerprint(const SubjectPublicKeyInfo& key);
   }  // namespace AuthSig
}  // namespace SystemService

PSIO_ADAPTER(SystemService::AuthSig::SubjectPublicKeyInfo,
             psio::text_category,
             SystemService::AuthSig::SubjectPublicKeyInfoText)
