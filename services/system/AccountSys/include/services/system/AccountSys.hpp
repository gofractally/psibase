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

   struct CreatorRecord
   {
      psibase::SingletonKey  key;
      psibase::AccountNumber accountCreator;
   };
   PSIO_REFLECT(CreatorRecord, key, accountCreator);
   using CreatorTable = psibase::Table<CreatorRecord, &CreatorRecord::key>;

   // TODO: account deletion, with an index to prevent reusing IDs
   // TODO: a mode which restricts which account may use newAccount.
   //       also let the UI know.
   class AccountSys : public psibase::Service<AccountSys>
   {
     public:
      static constexpr auto                   service     = psibase::AccountNumber("account-sys");
      static constexpr psibase::AccountNumber nullAccount = psibase::AccountNumber(0);

      using Tables = psibase::ServiceTables<AccountSysStatusTable, AccountTable, CreatorTable>;

      void init();
      void newAccount(psibase::AccountNumber name,
                      psibase::AccountNumber authService,
                      bool                   requireNew);
      void setAuthCntr(psibase::AccountNumber authService);
      bool exists(psibase::AccountNumber num);

      void setCreator(psibase::AccountNumber creator);

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
                method(setAuthCntr, authService),
                method(exists, num),
                method(setCreator, creator)
                //
   )
}  // namespace SystemService
