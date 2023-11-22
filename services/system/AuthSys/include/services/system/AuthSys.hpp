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

   /// The public key type used by this auth service.
   /// It is encoded as an X.509 SubjectPublicKeyInfo.
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

   /// A record containing the authorization claims needed for an account using this auth service.
   struct AuthRecord
   {
      /// The account whose transactions will be required to contain the specified public key.
      psibase::AccountNumber account;
      
      /// The public key included in the claims for each transaction sent by this account.
      SubjectPublicKeyInfo   pubkey;

      auto byPubkey() const { return std::tuple{pubkey, account}; }
   };
   PSIO_REFLECT(AuthRecord, account, pubkey)

   /// The `auth-sys` service is an auth service that can be used to authenticate actions for accounts.
   ///
   /// Any account using this auth service must store in this service a public key that they own.
   /// This service will ensure that the specified public key is included in the transaction claims for any
   /// transaction sent by this account. 
   ///
   /// This service supports K1 or R1 keys (Secp256K1 or Secp256R1) keys.
   class AuthSys : public psibase::Service<AuthSys>
   {
     public:
      static constexpr auto service = psibase::AccountNumber("auth-sys");
      using AuthTable = psibase::Table<AuthRecord, &AuthRecord::account, &AuthRecord::byPubkey>;
      using Tables    = psibase::ServiceTables<AuthTable>;

      /// This is an implementation of the standard auth service interface defined in [SystemService::AuthInterface]
      /// 
      /// It will be automatically called by `transact-sys` when it is processing a transaction from a user who
      /// has set this service as their auth service.
      ///
      /// This action verifies that the transaction contains a claim for the user's public key.
      void checkAuthSys(uint32_t                    flags,
                        psibase::AccountNumber      requester,
                        psibase::Action             action,
                        std::vector<ServiceMethod>  allowedActions,
                        std::vector<psibase::Claim> claims);

      /// This is an implementation of the standard auth service interface defined in [SystemService::AuthInterface]
      /// 
      /// It will be automatically called by `account-sys` when a user attempts to configure their account to use this
      /// auth service. 
      ///
      /// Verifies that a particular user is allowed to use a particular auth service. 
      ///
      /// This action allows any user who has already set a public key using `AuthSys::setKey`.
      void canAuthUserSys(psibase::AccountNumber user);

      /// Set the sender's public key
      /// 
      /// This is the public key that must be claimed by the transaction whenever a sender using this auth service 
      /// submits a transaction.
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
