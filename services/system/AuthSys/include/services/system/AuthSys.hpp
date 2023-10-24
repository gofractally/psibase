#pragma once

#include <psibase/Service.hpp>
#include <psibase/Table.hpp>
#include <services/system/TransactionSys.hpp>
#include <string>
#include <string_view>
#include <tuple>
#include <vector>

namespace SystemService
{

   struct SubjectPublicKeyInfo
   {
      std::vector<unsigned char> data;
      friend bool operator==(const SubjectPublicKeyInfo&, const SubjectPublicKeyInfo&) = default;
      friend auto operator<=>(const SubjectPublicKeyInfo& lhs, const SubjectPublicKeyInfo& rhs)
      {
         return psibase::compare_wknd(lhs.data, rhs.data);
      }
   };
   std::vector<unsigned char>& clio_unwrap_packable(SubjectPublicKeyInfo& obj)
   {
      return obj.data;
   }
   const std::vector<unsigned char>& clio_unwrap_packable(const SubjectPublicKeyInfo& obj)
   {
      return obj.data;
   }
   // Takes a public key in any of the following formats
   // - EOS Base58 encoded public key beginning PUB_K1 or PUB_R1
   // - PEM encoded X.509 SubjectPublicKeyInfo
   // Returns DER encoded SubjectPublicKeyInfo
   std::vector<unsigned char> parseSubjectPublicKeyInfo(std::string_view);
   std::string                to_string(const SubjectPublicKeyInfo&);
   void                       from_json(SubjectPublicKeyInfo& key, auto& stream)
   {
      key.data = parseSubjectPublicKeyInfo(stream.get_string());
   }
   void to_json(const SubjectPublicKeyInfo& key, auto& stream)
   {
      to_json(to_string(key), stream);
   }
   inline constexpr bool use_json_string_for_gql(SubjectPublicKeyInfo*)
   {
      return true;
   }
   void to_key(const SubjectPublicKeyInfo& obj, auto& stream)
   {
      to_key(obj.data, stream);
   }

   struct AuthRecord
   {
      psibase::AccountNumber account;
      SubjectPublicKeyInfo   pubkey;

      auto byPubkey() const { return std::tuple{pubkey, account}; }
   };
   PSIO_REFLECT(AuthRecord, account, pubkey)

   class AuthSys : public psibase::Service<AuthSys>
   {
     public:
      static constexpr auto service = psibase::AccountNumber("auth-sys");
      using AuthTable = psibase::Table<AuthRecord, &AuthRecord::account, &AuthRecord::byPubkey>;
      using Tables    = psibase::ServiceTables<AuthTable>;

      void checkAuthSys(uint32_t                    flags,
                        psibase::AccountNumber      requester,
                        psibase::Action             action,
                        std::vector<ServiceMethod>  allowedActions,
                        std::vector<psibase::Claim> claims);

      void canAuthUserSys(psibase::AccountNumber user);
      void setKey(SubjectPublicKeyInfo key);

     private:
      Tables db{psibase::getReceiver()};
   };
   PSIO_REFLECT(AuthSys,  //
                method(checkAuthSys, flags, requester, action, allowedActions, claims),
                method(canAuthUserSys, user),
                method(setKey, key)
                //
   )
}  // namespace SystemService
