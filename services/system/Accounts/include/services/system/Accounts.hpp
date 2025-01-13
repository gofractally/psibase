#pragma once
#include <psibase/RawNativeFunctions.hpp>
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

      std::tuple<> key() const { return {}; }
   };
   PSIO_REFLECT(AccountsStatus, totalAccounts)
   using AccountsStatusTable = psibase::Table<AccountsStatus, &AccountsStatus::key>;

   struct ResourceLimit
   {
      static ResourceLimit fromCpu(std::chrono::nanoseconds cpu)
      {
         psibase::check(cpu >= std::chrono::nanoseconds(0), "billed cpu must be non-negative");
         psibase::check(static_cast<std::uintmax_t>(cpu.count()) <= UINT64_MAX, "integer overflow");
         return {static_cast<std::uint64_t>(cpu.count())};
      }
      std::chrono::nanoseconds cpuLimit()
      {
         if (value <= static_cast<std::uintmax_t>(std::chrono::nanoseconds::max().count()))
         {
            return std::chrono::nanoseconds(value);
         }
         else
         {
            return std::chrono::nanoseconds::max();
         }
      }
      friend ResourceLimit operator-(ResourceLimit lhs, ResourceLimit rhs)
      {
         psibase::check(lhs.value >= rhs.value, "insufficient resources");
         return {lhs.value - rhs.value};
      }
      void          billCpu(std::chrono::nanoseconds cpu) { *this = *this - fromCpu(cpu); }
      std::uint64_t value;
   };
   PSIO_REFLECT(ResourceLimit, definitionWillNotChange(), value);

   /// Structure of an account
   ///
   /// `accountNum` is the name of the account
   /// `authService` is the service used to verify the transaction claims when `accountNum` is the sender
   /// `resourceBalance` is the available resources for the account
   struct Account
   {
      psibase::AccountNumber accountNum;
      psibase::AccountNumber authService;

      // If this is absent, it means resource usage is unlimited
      std::optional<ResourceLimit> resourceBalance;

      auto key() const { return accountNum; }
   };
   PSIO_REFLECT(Account, accountNum, authService, resourceBalance)
   using AccountTable = psibase::Table<Account, &Account::key>;

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

      /// Reduces the account balance. Aborts the transaction if the
      /// account does not have sufficient resources.
      void billCpu(psibase::AccountNumber name, std::chrono::nanoseconds amount);
   };

   PSIO_REFLECT(Accounts,
                method(init),
                method(newAccount, name, authService, requireNew),
                method(setAuthServ, authService),
                method(getAccount, name),
                method(getAuthOf, account),
                method(exists, name),
                method(billCpu, name, amount)
                //
   )
}  // namespace SystemService
