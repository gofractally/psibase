#pragma once

#include <cstdint>
#include <psibase/AccountNumber.hpp>
#include <psibase/Service.hpp>
#include <psibase/Table.hpp>
#include <psibase/block.hpp>
#include <psio/reflect.hpp>
#include <services/system/Transact.hpp>
#include <vector>

namespace SystemService
{

   struct AuthDelegateRecord
   {
      psibase::AccountNumber account;
      psibase::AccountNumber owner;
   };
   PSIO_REFLECT(AuthDelegateRecord, account, owner)

   /// The `auth-delegate` service is an auth service that can be used to authenticate actions for accounts.
   ///
   /// Any account using this auth service must store in this service the name of
   /// the other account that owns it.
   class AuthDelegate : public psibase::Service
   {
     public:
      static constexpr auto service = psibase::AccountNumber("auth-delegate");
      using AuthDelegateTable = psibase::Table<AuthDelegateRecord, &AuthDelegateRecord::account>;
      using Tables            = psibase::ServiceTables<AuthDelegateTable>;

      /// This is an implementation of the standard auth service interface defined in [SystemService::AuthInterface]
      ///
      /// This action is automatically called by `transact` when an account using this auth service submits a
      /// transaction.
      ///
      /// This action forwards verification to the owning account
      void checkAuthSys(std::uint32_t               flags,
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
      /// This action allows any user who has already set an owning account with `AuthDelegate::setOwner`.
      void canAuthUserSys(psibase::AccountNumber user);

      /// Check whether a specified set of authorizer accounts are sufficient to authorize sending a
      /// transaction from a specified sender.
      ///
      /// * `sender`: The sender account for the transaction potentially being authorized.
      /// * `authorizers`: The set of accounts that have already authorized the execution of the transaction.
      ///
      /// Returns:
      /// * `true`: If the sender's owner is among the authorizers, or if the sender's owner's auth
      /// service would authorize the transaction
      /// * `false`: If not returning true
      bool isAuthSys(psibase::AccountNumber              sender,
                     std::vector<psibase::AccountNumber> authorizers);

      /// Check whether a specified set of rejecter accounts are sufficient to reject (cancel) a
      /// transaction from a specified sender.
      ///
      /// * `sender`: The sender account for the transaction potentially being rejected.
      /// * `rejecters`: The set of accounts that have already authorized the rejection of the transaction.
      ///
      /// Returns:
      /// * `true`: If the sender's owner is among the rejecters, or if the sender's owner's auth
      /// service would reject the transaction
      /// * `false`: If not returning true
      bool isRejectSys(psibase::AccountNumber              sender,
                       std::vector<psibase::AccountNumber> rejecters);

      /// Set the owner of the sender account
      ///
      /// Whenever a sender using this auth service submits a transaction, authorization
      /// for the owned account will check authorization for the owner instead.
      void setOwner(psibase::AccountNumber owner);

     private:
      Tables                        db{psibase::getReceiver()};
      psibase::AccountNumber        getOwner(psibase::AccountNumber account);
      psibase::Actor<AuthInterface> authServiceOf(psibase::AccountNumber account);
   };
   PSIO_REFLECT(AuthDelegate,  //
                method(checkAuthSys, flags, requester, sender, action, allowedActions, claims),
                method(canAuthUserSys, user),
                method(isAuthSys, sender, authorizers),
                method(isRejectSys, sender, rejecters),
                method(setOwner, owner)
                //
   )

}  // namespace SystemService
