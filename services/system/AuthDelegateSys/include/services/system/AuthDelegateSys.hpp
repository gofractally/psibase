#pragma once

#include <cstdint>
#include <psibase/AccountNumber.hpp>
#include <psibase/Service.hpp>
#include <psibase/Table.hpp>
#include <psibase/block.hpp>
#include <psio/reflect.hpp>
#include <services/system/TransactionSys.hpp>
#include <vector>

namespace SystemService
{

   struct AuthDelegateRecord
   {
      psibase::AccountNumber account;
      psibase::AccountNumber owner;
   };
   PSIO_REFLECT(AuthDelegateRecord, account, owner)

   /// The `auth-dlg-sys` service is an auth service that can be used to authenticate actions for accounts.
   ///
   /// Any account using this auth service must store in this service the name of
   /// the other account that owns it.
   class AuthDelegateSys : public psibase::Service<AuthDelegateSys>
   {
     public:
      static constexpr auto service = psibase::AccountNumber("auth-dlg-sys");
      using AuthDelegateTable = psibase::Table<AuthDelegateRecord, &AuthDelegateRecord::account>;
      using Tables            = psibase::ServiceTables<AuthDelegateTable>;

      /// This is an implementation of the standard auth service interface defined in [SystemService::AuthInterface]
      ///
      /// This action is automatically called by `transact-sys` when an account using this auth service submits a
      /// transaction.
      ///
      /// This action forwards verification to the owning account
      void checkAuthSys(std::uint32_t               flags,
                        psibase::AccountNumber      requester,
                        psibase::Action             action,
                        std::vector<ServiceMethod>  allowedActions,
                        std::vector<psibase::Claim> claims);

      /// This is an implementation of the standard auth service interface defined in [SystemService::AuthInterface]
      ///
      /// This action is automatically called by `account-sys` when an account is configured to use this auth service.
      ///
      /// Verifies that a particular user is allowed to use a particular auth service.
      ///
      /// This action allows any user who has already set an owning account with `AuthDelegateSys::setOwner`.
      void canAuthUserSys(psibase::AccountNumber user);

      /// Set the owner of the sender account
      ///
      /// Whenever a sender using this auth service submits a transaction, authorization
      /// for the owned account will check authorization for the owner instead.
      void setOwner(psibase::AccountNumber owner);

     private:
      Tables db{psibase::getReceiver()};
   };
   PSIO_REFLECT(AuthDelegateSys,  //
                method(checkAuthSys, flags, requester, action, allowedActions, claims),
                method(canAuthUserSys, user),
                method(setOwner, owner)
                //
   )

}  // namespace SystemService
