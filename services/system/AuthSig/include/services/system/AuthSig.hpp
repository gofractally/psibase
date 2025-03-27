#pragma once

#include <psibase/Service.hpp>
#include <psibase/Table.hpp>
#include <services/system/Transact.hpp>
#include <string>
#include <string_view>
#include <tuple>
#include <vector>

#include "Spki.hpp"

namespace SystemService
{
   namespace AuthSig
   {

      /// A record containing the authorization claims needed for an account using this auth service.
      struct AuthRecord
      {
         /// The account whose transactions will be required to contain the specified public key.
         psibase::AccountNumber account;

         /// The public key included in the claims for each transaction sent by this account.
         SubjectPublicKeyInfo pubkey;

         auto byPubkey() const { return std::tuple{keyFingerprint(pubkey), account}; }
      };
      PSIO_REFLECT(AuthRecord, account, pubkey)

      /// The `auth-sig` service is an auth service that can be used to authenticate actions for accounts.
      ///
      /// Any account using this auth service must store in this service a public key that they own.
      /// This service will ensure that the specified public key is included in the transaction claims for any
      /// transaction sent by this account.
      ///
      /// This service supports K1 or R1 keys (Secp256K1 or Secp256R1) keys.
      class AuthSig : public psibase::Service
      {
        public:
         static constexpr auto service = psibase::AccountNumber("auth-sig");
         using AuthTable = psibase::Table<AuthRecord, &AuthRecord::account, &AuthRecord::byPubkey>;
         using Tables    = psibase::ServiceTables<AuthTable>;

         /// This is an implementation of the standard auth service interface defined in [SystemService::AuthInterface]
         ///
         /// This action is automatically called by `transact` when an account using this auth service submits a
         /// transaction.
         ///
         /// This action verifies that the transaction contains a claim for the user's public key.
         void checkAuthSys(uint32_t                    flags,
                           psibase::AccountNumber      requester,
                           psibase::AccountNumber      sender,
                           ServiceMethod               action,
                           std::vector<ServiceMethod>  allowedActions,
                           std::vector<psibase::Claim> claims);

         /// This is an implementation of the standard auth service interface defined in [SystemService::AuthInterface]
         ///
         /// This action is automatically called by `accounts` when an account is configured to use this auth service.
         ///
         /// Verifies that a particular user is allowed to use a particular auth service.
         ///
         /// This action allows any user who has already set a public key using `AuthSig::setKey`.
         void canAuthUserSys(psibase::AccountNumber user);

         /// Set the sender's public key
         ///
         /// This is the public key that must be claimed by the transaction whenever a sender using this auth service
         /// submits a transaction.
         void setKey(SubjectPublicKeyInfo key);

         /// Check whether a specified set of authorizer accounts are sufficient to authorize sending a
         /// transaction from a specified sender.
         ///
         /// * `sender`: The sender account for the transaction potentially being authorized.
         /// * `authorizers`: The set of accounts that have already authorized the execution of the transaction.
         ///
         /// Returns:
         /// * `true`: If the sender is among the authorizers
         /// * `false`: If the sender is not among the authorizers
         bool isAuthSys(psibase::AccountNumber              sender,
                        std::vector<psibase::AccountNumber> authorizers);

         /// Check whether a specified set of rejecter accounts are sufficient to reject (cancel) a
         /// transaction from a specified sender.
         ///
         /// * `sender`: The sender account for the transaction potentially being rejected.
         /// * `rejecters`: The set of accounts that have already authorized the rejection of the transaction.
         ///
         /// Returns:
         /// * `true`: If the sender is among the rejecters
         /// * `false`: If the sender is not among the rejecters
         bool isRejectSys(psibase::AccountNumber              sender,
                          std::vector<psibase::AccountNumber> rejecters);

         /// Create a new account using this auth service configured with the specified public key.
         void newAccount(psibase::AccountNumber name, SubjectPublicKeyInfo key);

        private:
         Tables db{psibase::getReceiver()};
      };
      PSIO_REFLECT(AuthSig,  //
                   method(checkAuthSys, flags, requester, sender, action, allowedActions, claims),
                   method(canAuthUserSys, user),
                   method(setKey, key),
                   method(isAuthSys, sender, authorizers),
                   method(isRejectSys, sender, rejecters),
                   method(newAccount, name, key)
                   //
      )
      PSIBASE_REFLECT_TABLES(AuthSig, AuthSig::Tables)
      PSIO_REFLECT_TYPENAME(AuthSig::AuthTable)
   }  // namespace AuthSig
}  // namespace SystemService
