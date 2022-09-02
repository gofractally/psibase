#pragma once
#include <psibase/Contract.hpp>
#include <psibase/Table.hpp>
#include <psibase/name.hpp>
#include <psibase/nativeFunctions.hpp>
#include <psibase/nativeTables.hpp>

namespace system_contract
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
      psibase::AccountNumber authContract;

      auto key() const { return accountNum; }
   };
   PSIO_REFLECT(Account, accountNum, authContract)
   using AccountTable = psibase::Table<Account, &Account::key>;

   struct SingletonKey
   {
   };
   PSIO_REFLECT(SingletonKey);
   struct CreatorRecord
   {
      SingletonKey           key;
      psibase::AccountNumber accountCreator;
   };
   PSIO_REFLECT(CreatorRecord, key, accountCreator);
   using CreatorTable = psibase::Table<CreatorRecord, &CreatorRecord::key>;

   // TODO: account deletion, with an index to prevent reusing IDs
   // TODO: a mode which restricts which account may use newAccount.
   //       also let the UI know.
   class AccountSys : public psibase::Contract<AccountSys>
   {
     public:
      static constexpr auto                   service     = psibase::AccountNumber("account-sys");
      static constexpr psibase::AccountNumber nullAccount = psibase::AccountNumber(0);

      using Tables = psibase::ContractTables<AccountSysStatusTable, AccountTable, CreatorTable>;

      void startup();
      void newAccount(psibase::AccountNumber name,
                      psibase::AccountNumber authContract,
                      bool                   requireNew);
      void setAuthCntr(psibase::AccountNumber authContract);
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
                method(startup, existing_accounts),
                method(newAccount, name, authContract, requireNew),
                method(setAuthCntr, authContract),
                method(exists, num),
                method(setCreator, creator)
                //
   )
}  // namespace system_contract
