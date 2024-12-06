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

      /// Handle notification related to the acceptance of a staged transaction
      ///
      /// Auth-delegate will execute the staged transaction if the sender of the call to `accept`
      /// is the owner account of the sender of the staged transaction.
      void stagedAccept(uint32_t staged_tx_id, psibase::AccountNumber actor);

      /// Handle notification related to the rejection of a staged transaction
      ///
      /// Auth-delegate will reject the staged transaction if the sender of the call to `reject`
      /// is the owner account of the sender of the staged transaction.
      void stagedReject(uint32_t staged_tx_id, psibase::AccountNumber actor);

      /// Set the owner of the sender account
      ///
      /// Whenever a sender using this auth service submits a transaction, authorization
      /// for the owned account will check authorization for the owner instead.
      void setOwner(psibase::AccountNumber owner);

     private:
      Tables db{psibase::getReceiver()};
   };
   PSIO_REFLECT(AuthDelegate,  //
                method(checkAuthSys, flags, requester, sender, action, allowedActions, claims),
                method(canAuthUserSys, user),
                method(stagedAccept, staged_tx_id, actor),
                method(stagedReject, staged_tx_id, actor),
                method(setOwner, owner)
                //
   )

}  // namespace SystemService
