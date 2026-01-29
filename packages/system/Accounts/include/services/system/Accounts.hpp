#pragma once
#include <psibase/Service.hpp>
#include <psibase/Table.hpp>
#include <psibase/name.hpp>
#include <psibase/nativeTables.hpp>
#include <psio/chrono.hpp>

namespace SystemService
{
   /// Shows statistics accross accounts
   ///
   /// `totalAccounts` holds the total number of accounts on chain
   struct AccountsStatus
   {
      uint32_t totalAccounts = 0;
   };
   PSIO_REFLECT(AccountsStatus, totalAccounts)
   using AccountsStatusTable = psibase::Table<AccountsStatus, psibase::SingletonKey{}>;
   PSIO_REFLECT_TYPENAME(AccountsStatusTable)

   /// Structure of an account
   ///
   /// `accountNum` is the name of the account
   /// `authService` is the service used to verify the transaction claims when `accountNum` is the sender
   struct Account
   {
      psibase::AccountNumber accountNum;
      psibase::AccountNumber authService;
   };
   PSIO_REFLECT(Account, accountNum, authService)
   using AccountTable = psibase::Table<Account, &Account::accountNum>;
   PSIO_REFLECT_TYPENAME(AccountTable)

   /// This service facilitates the creation of new accounts
   ///
   /// Only the Accounts service itself and the `inviteService` may create new accounts.
   /// Other services may also use this service to check if an account exists.
   // TODO: account deletion, with an index to prevent reusing IDs
   class Accounts : public psibase::Service
   {
     public:
      /// "accounts"
      static constexpr auto service = psibase::AccountNumber("accounts");
      /// "invite"
      static constexpr auto inviteService = psibase::AccountNumber("invite");
      /// AccountNumber 0 is reserved for the null account
      static constexpr psibase::AccountNumber nullAccount = psibase::AccountNumber(0);

      using Tables = psibase::ServiceTables<AccountsStatusTable, AccountTable>;

      /// Only called once during chain initialization
      ///
      /// Creates accounts for other system services.
      void init();

      /// Used to create a new account with a specified auth service
      ///
      /// The accounts permitted to call this action are restricted to either Accounts itself
      /// or the service indicated by `inviteService`. If the `requireNew` flag is set, then
      /// the action will fail if the `name` account already exists.
      void newAccount(psibase::AccountNumber name,
                      psibase::AccountNumber authService,
                      bool                   requireNew);

      /// Used to update the auth service used by an account
      void setAuthServ(psibase::AccountNumber authService);

      /// Returns data about an account from the accounts table
      std::optional<Account> getAccount(psibase::AccountNumber name);

      /// Returns the auth service of the specified account
      ///
      /// Aborts if the account does not exist
      psibase::AccountNumber getAuthOf(psibase::AccountNumber account);

      /// Return value indicates whether the account `name` exists
      bool exists(psibase::AccountNumber name);
   };

   PSIO_REFLECT(Accounts,
                method(init),
                method(newAccount, name, authService, requireNew),
                method(setAuthServ, authService),
                method(getAccount, name),
                method(getAuthOf, account),
                method(exists, name),
                //
   )

   PSIBASE_REFLECT_TABLES(Accounts, Accounts::Tables)
}  // namespace SystemService
