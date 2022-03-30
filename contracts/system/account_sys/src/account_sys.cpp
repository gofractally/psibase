#include <contracts/system/account_sys.hpp>

#include <contracts/system/transaction_sys.hpp>
#include <psibase/dispatch.hpp>
#include <psibase/native_tables.hpp>

static constexpr bool enable_print = false;

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

   void account_sys::startup(const_view<vector<AccountNumber>> existing_accounts)
   {
      check(!kv_get<account_sys_status_row>(account_sys_status_key()), "already started");
      auto s = existing_accounts->size();

      kv_put(account_sys_status_key(), account_sys_status_row{.total_accounts = s});

      /*
      eosio::print("existing accounts size: ", s, "\n");
      for (uint32_t i = 0; i < s; ++i)
      {
         auto r = existing_accounts[i];
     //    eosio::print((uint32_t)r->num(), " ", std::string_view(r->name()), "\n");
         register_acc(r->num() );
      }
      */
   }

   void account_sys::create_account(AccountNumber acc, AccountNumber auth_contract, bool allow_sudo)
   {
      auto status = kv_get<account_sys_status_row>(account_sys_status_key());
      check(status.has_value(), "not started");
      write_console("new acc: ");
      write_console(acc.str());

      write_console("auth con: ");
      write_console(auth_contract.str());

      check(!exists(acc), "account already exists");
      check(exists(auth_contract), "unknown auth contract");

      uint32_t flags = 0;

      // TODO: restrict ability to set this flag
      // TODO: support entire set of flags
      if (allow_sudo)
         flags |= account_row::allow_sudo;

      status->total_accounts++;
      account_row account{
          .num           = acc,
          .auth_contract = auth_contract,
          .flags         = flags,
      };
      kv_put(status->key(), *status);
      kv_put(account.kv_map, account.key(), account);
   }

   uint8_t account_sys::exists(AccountNumber num)
   {
      return !!kv_get<account_row>(account_row::kv_map, account_key(num));
   }

}  // namespace system_contract

PSIBASE_DISPATCH(system_contract::account_sys)
