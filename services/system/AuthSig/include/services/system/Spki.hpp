#pragma once
#include <psibase/Table.hpp>
#include <string>
#include <vector>

namespace SystemService
{
   namespace AuthSig
   {
      /// The public key type used by this library.
      /// It is encoded as an X.509 SubjectPublicKeyInfo.
      struct SubjectPublicKeyInfo
      {
         std::vector<unsigned char> data;

         static bool validate(const std::vector<unsigned char>& data);

         friend bool operator==(const SubjectPublicKeyInfo&, const SubjectPublicKeyInfo&) = default;
         friend auto operator<=>(const SubjectPublicKeyInfo& lhs, const SubjectPublicKeyInfo& rhs)
         {
            return psibase::compare_wknd(lhs.data, rhs.data);
         }
      };

      inline std::vector<unsigned char>& clio_unwrap_packable(SubjectPublicKeyInfo& obj)
      {
         return obj.data;
      }
      inline const std::vector<unsigned char>& clio_unwrap_packable(const SubjectPublicKeyInfo& obj)
      {
         return obj.data;
      }
      inline bool clio_validate_packable(const SubjectPublicKeyInfo& obj)
      {
         return SubjectPublicKeyInfo::validate(obj.data);
      }

      // Takes a public key as a PEM encoded X.509 SubjectPublicKeyInfo
      // Returns a DER encoded SubjectPublicKeyInfo
      std::vector<unsigned char> parseSubjectPublicKeyInfo(std::string_view);
      std::string                to_string(const SubjectPublicKeyInfo&);

      void from_json(SubjectPublicKeyInfo& key, auto& stream)
      {
         key.data = parseSubjectPublicKeyInfo(stream.get_string());
      }
      void to_json(const SubjectPublicKeyInfo& key, auto& stream)
      {
         to_json(to_string(key), stream);
      }
      void to_key(const SubjectPublicKeyInfo& obj, auto& stream)
      {
         to_key(obj.data, stream);
      }
      inline constexpr bool use_json_string_for_gql(SubjectPublicKeyInfo*)
      {
         return true;
      }

      psibase::Checksum256 keyFingerprint(const SubjectPublicKeyInfo& key);
   }  // namespace AuthSig
}  // namespace SystemService