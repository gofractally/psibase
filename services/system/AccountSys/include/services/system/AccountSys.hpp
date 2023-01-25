#pragma once
#include <psibase/Service.hpp>
#include <psibase/Table.hpp>
#include <psibase/name.hpp>
#include <psibase/nativeFunctions.hpp>
#include <psibase/nativeTables.hpp>

namespace SystemService
{
   struct AccountSysStatus
   {
      uint32_t totalAccounts = 0;

      std::tuple<> key() const { return {}; }
   };
   PSIO_REFLECT(AccountSysStatus, totalAccounts)
   using AccountSysStatusTable = psibase::Table<AccountSysStatus, &AccountSysStatus::key>;

   struct Account
   {
      psibase::AccountNumber accountNum;
      psibase::AccountNumber authService;

      auto key() const { return accountNum; }
   };
   PSIO_REFLECT(Account, accountNum, authService)
   using AccountTable = psibase::Table<Account, &Account::key>;

   // TODO: account deletion, with an index to prevent reusing IDs
   // TODO: a mode which restricts which account may use newAccount.
   //       also let the UI know.
   class AccountSys : public psibase::Service<AccountSys>
   {
     public:
      static constexpr auto                   service       = psibase::AccountNumber("account-sys");
      static constexpr auto                   inviteService = psibase::AccountNumber("invite-sys");
      static constexpr psibase::AccountNumber nullAccount   = psibase::AccountNumber(0);

      using Tables = psibase::ServiceTables<AccountSysStatusTable, AccountTable>;

      void init();
      void newAccount(psibase::AccountNumber name,
                      psibase::AccountNumber authService,
                      bool                   requireNew);

      /// Used to update the auth service used by an account
      void setAuthServ(psibase::AccountNumber authService);

      /// Return value indicates whether the account `name` exists
      bool exists(psibase::AccountNumber name);

      struct Events
      {
         struct History
         {
         };
         struct Ui
         {
         };
         struct Merkle
         {
         };
      };
   };

   PSIO_REFLECT(AccountSys,
                method(init),
                method(newAccount, name, authService, requireNew),
                method(setAuthServ, authService),
                method(exists, name)
                //
   )
}  // namespace SystemService
