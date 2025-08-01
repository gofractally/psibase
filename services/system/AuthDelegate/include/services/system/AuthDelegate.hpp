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

      using Secondary =
          psibase::CompositeKey<&AuthDelegateRecord::owner, &AuthDelegateRecord::account>;
   };
   PSIO_REFLECT(AuthDelegateRecord, account, owner)
   using AuthDelegateTable = psibase::
       Table<AuthDelegateRecord, &AuthDelegateRecord::account, AuthDelegateRecord::Secondary{}>;
   PSIO_REFLECT_TYPENAME(AuthDelegateTable)

   /// The `auth-delegate` service is an auth service that can be used to authenticate actions for accounts.
   ///
   /// Any account using this auth service must store in this service the name of
   /// the other account that owns it.
   class AuthDelegate : public psibase::Service
   {
     public:
      static constexpr auto service = psibase::AccountNumber("auth-delegate");
      using Tables                  = psibase::ServiceTables<AuthDelegateTable>;

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
      /// * `false`: If not returning true, or on recursive checks for the same sender
      bool isAuthSys(psibase::AccountNumber                             sender,
                     std::vector<psibase::AccountNumber>                authorizers,
                     std::optional<std::vector<psibase::AccountNumber>> authSet);

      /// Check whether a specified set of rejecter accounts are sufficient to reject (cancel) a
      /// transaction from a specified sender.
      ///
      /// * `sender`: The sender account for the transaction potentially being rejected.
      /// * `rejecters`: The set of accounts that have already authorized the rejection of the transaction.
      ///
      /// Returns:
      /// * `true`: If the sender's owner is among the rejecters, or if the sender's owner's auth
      /// service would reject the transaction
      /// * `false`: If not returning true, or on recursive checks for the same sender
      bool isRejectSys(psibase::AccountNumber                             sender,
                       std::vector<psibase::AccountNumber>                rejecters,
                       std::optional<std::vector<psibase::AccountNumber>> authSet);

      /// Set the owner of the sender account
      ///
      /// Whenever a sender using this auth service submits a transaction, authorization
      /// for the owned account will check authorization for the owner instead.
      void setOwner(psibase::AccountNumber owner);

      /// Create a new account with the specified name, owned by the specified `owner` account.
      void newAccount(psibase::AccountNumber name, psibase::AccountNumber owner);

      psibase::AccountNumber getOwner(psibase::AccountNumber account);

     private:
      Tables                        db{psibase::getReceiver()};
      psibase::Actor<AuthInterface> authServiceOf(psibase::AccountNumber account);
   };
   PSIO_REFLECT(AuthDelegate,  //
                method(checkAuthSys, flags, requester, sender, action, allowedActions, claims),
                method(canAuthUserSys, user),
                method(isAuthSys, sender, authorizers, authSet),
                method(isRejectSys, sender, rejecters, authSet),
                method(setOwner, owner),
                method(newAccount, name, owner),
                method(getOwner, owner)
                //
   )
   PSIBASE_REFLECT_TABLES(AuthDelegate, AuthDelegate::Tables)

}  // namespace SystemService
