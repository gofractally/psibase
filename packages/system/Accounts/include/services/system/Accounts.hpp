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
      /// authSequence is used to prevent authorization for actions
      /// from carrying over when an account's authorization is changed.
      /// Services such as staged-tx that remember approvals should
      /// also record the current authSequence when the approval was
      /// given and invalidate the approval if the authSequence
      /// has changed. The sequence is 64 bits, to make cycling it
      /// infeasible.
      std::uint64_t authSequence;
   };
   PSIO_REFLECT(Account, accountNum, authService, authSequence)
   using AccountTable = psibase::Table<Account, &Account::accountNum>;
   PSIO_REFLECT_TYPENAME(AccountTable)

   /// Determines the behavior of `newAccount` when the
   /// requested account already exists
   enum class NewAccountMode : std::uint8_t
   {
      /// An existing account will be unchanged.
      keepExisting,
      /// If the account already exists, it must match
      /// the parameters that are passed to `newAccount`.
      /// This should be used when idempotent account
      /// creation is needed.
      matchExisting,
      /// The account must not already exist.
      requireNew,
   };

   void from_json(NewAccountMode& obj, auto& stream)
   {
      std::uint32_t value;
      from_json(value, stream);
      psibase::check(value <= 2, "mode out of range");
      obj = static_cast<NewAccountMode>(value);
   }

   void to_json(const NewAccountMode& obj, auto& stream)
   {
      to_json(static_cast<std::uint32_t>(obj), stream);
   }

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

      /// Preapprove an account of any length to be created within this transaction.
      /// If an account is preapproved, it will bypass naming restrictions.
      ///
      /// The `Accounts` or `NameMarket` service must authorize this action.
      /// Names with an "x-" prefix must be preapproved by the `Accounts` service specifically.
      ///
      /// The preapproval only lasts for the duration of the transaction context, after
      /// which the preapproval is cleared.
      void preapproveAcc(psibase::AccountNumber name);

      /// Used to create a new account with a specified auth service
      ///
      /// The behavior if the account already exists is determined by `mode`
      ///
      /// Returns true if an account was created
      bool newAccount(psibase::AccountNumber name,
                      psibase::AccountNumber authService,
                      NewAccountMode         mode);

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

      /// An auth service should call this whenever an account's
      /// auth rules change. Has no effect if the sender is not
      /// the account's auth service.
      void incAuthSeq(psibase::AccountNumber name);
   };

   PSIO_REFLECT(Accounts,
                method(init),
                method(preapproveAcc, name),
                method(newAccount, name, authService, mode),
                method(setAuthServ, authService),
                method(getAccount, name),
                method(getAuthOf, account),
                method(exists, name),
                method(incAuthSeq, name),
                //
   )

   PSIBASE_REFLECT_TABLES(Accounts, Accounts::Tables)
}  // namespace SystemService
