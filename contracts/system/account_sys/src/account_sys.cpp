#include <contracts/system/account_sys.hpp>

#include <contracts/system/transaction_sys.hpp>
#include <psibase/dispatch.hpp>
#include <psibase/native_tables.hpp>

static constexpr bool enable_print = false;

using namespace psibase;

namespace system_contract
{
   static constexpr table_num account_sys_status_table = 1;

   inline auto account_sys_status_key()
   {
      return std::tuple{account_sys::contract, account_sys_status_table};
   }
   struct account_sys_status_row
   {
      uint32_t total_accounts = 0;

      static auto key() { return account_sys_status_key(); }
   };
   PSIO_REFLECT(account_sys_status_row, total_accounts)

   // TODO: remove existing_accounts arg
   // TODO: scan native table to get total_accounts
   void account_sys::startup(psio::const_view<std::vector<AccountNumber>> existing_accounts)
   {
      check(!kv_get<account_sys_status_row>(account_sys_status_key()), "already started");
      auto s = existing_accounts->size();

      kv_put(account_sys_status_key(), account_sys_status_row{.total_accounts = s});
   }

   void account_sys::newAccount(AccountNumber name, AccountNumber authContract, bool requireNew)
   {
      auto status = kv_get<account_sys_status_row>(account_sys_status_key());
      check(status.has_value(), "not started");

      if (enable_print)
      {
         writeConsole("new acc: ");
         writeConsole(name.str());
         writeConsole("auth con: ");
         writeConsole(authContract.str());
      }

      check(name.value, "empty account name");
      if (exists(name))
      {
         if (requireNew)
            abortMessage("account already exists");
         return;
      }
      check(exists(authContract), "unknown auth contract");

      status->total_accounts++;
      account_row account{
          .num          = name,
          .authContract = authContract,
          .flags        = 0,
      };
      kv_put(status->key(), *status);
      kv_put(account.kv_map, account.key(), account);
   }

   bool account_sys::exists(AccountNumber num)
   {
      return !!kv_get<account_row>(account_row::kv_map, account_key(num));
   }

}  // namespace system_contract

PSIBASE_DISPATCH(system_contract::account_sys)
