#pragma once

#include <psibase/Table.hpp>
#include <psibase/crypto.hpp>
#include <psibase/serveContent.hpp>
#include <services/system/TransactionSys.hpp>

namespace SystemService
{
   namespace AuthEcRecord
   {  // Using a namespace here disambiguates this class from the one in AuthSys so docs don't get confused
      /// A record containing the authorization claims needed for an account using this auth service.
      struct AuthRecord
      {
         /// The account whose transactions will be required to contain the specified public key.
         psibase::AccountNumber account;

         /// The public key included in the claims for each transaction sent by this account.
         psibase::PublicKey pubkey;

         auto byPubkey() const { return std::tuple{pubkey, account}; }
      };
      PSIO_REFLECT(AuthRecord, account, pubkey)
   }  // namespace AuthEcRecord

   /// The `auth-ec-sys` service is an auth service that can be used to authenticate actions for accounts
   ///
   /// Any account using this auth service must store in this service an ECDCSA public key that they own.
   /// This service will ensure that the specified public key is included in the transaction claims for any
   /// transaction sent by this account.
   ///
   /// This service only supports K1 keys (Secp256K1) keys.
   class AuthEcSys : public psibase::Service<AuthEcSys>
   {
     public:
      static constexpr auto service = psibase::AccountNumber("auth-ec-sys");
      using AuthTable               = psibase::Table<AuthEcRecord::AuthRecord,
                                       &AuthEcRecord::AuthRecord::account,
                                       &AuthEcRecord::AuthRecord::byPubkey>;
      using Tables                  = psibase::ServiceTables<AuthTable>;

      /// This is an implementation of the standard auth service interface defined in [SystemService::AuthInterface]
      ///
      /// This action is automatically called by `transact-sys` when an account using this auth service submits a
      /// transaction.
      ///
      /// This action verifies that the transaction contains a claim for the user's public key.
      void checkAuthSys(uint32_t                    flags,
                        psibase::AccountNumber      requester,
                        psibase::AccountNumber      sender,
                        ServiceMethod               action,
                        std::vector<ServiceMethod>  allowedActions,
                        std::vector<psibase::Claim> claims);

      /// This is an implementation of the standard auth service interface defined by [SystemService::AuthInterface]
      ///
      /// This action is automatically called by `account-sys` when an account is configured to use this auth service.
      ///
      /// Verifies that a particular user is allowed to use a particular auth service.
      ///
      /// This action allows any user who has already set a public key using `AuthEcSys::setKey`.
      void canAuthUserSys(psibase::AccountNumber user);

      /// Set the sender's public key
      ///
      /// This is the public key that must be claimed by the transaction whenever a sender using this auth service
      /// submits a transaction. Only accepts K1 keys.
      void setKey(psibase::PublicKey key);

     private:
      Tables db{psibase::getReceiver()};
   };
   PSIO_REFLECT(AuthEcSys,  //
                method(checkAuthSys, flags, requester, sender, action, allowedActions, claims),
                method(canAuthUserSys, user),
                method(setKey, key)
                //
   )
}  // namespace SystemService
