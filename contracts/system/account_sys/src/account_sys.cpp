#include <contracts/system/account_sys.hpp>

#include <contracts/system/transaction_sys.hpp>
#include <psibase/dispatch.hpp>
#include <psibase/native_tables.hpp>

static constexpr bool enable_print = false;

namespace psibase
{
   using table_num = uint32_t;

   static constexpr table_num account_sys_status_table = 1;
   static constexpr table_num num_to_name_table        = 2;
   static constexpr table_num name_to_num_table        = 3;

   inline auto account_sys_status_key()
   {
      return std::tuple{account_sys::contract, account_sys_status_table};
   }
   struct account_sys_status_row
   {
      psibase::account_num next_account_num = 0;

      static auto key() { return account_sys_status_key(); }
   };
   EOSIO_REFLECT(account_sys_status_row, next_account_num)

   inline auto num_to_name_key(account_num num)
   {
      return std::tuple{account_sys::contract, num_to_name_table, num};
   }
   struct num_to_name_row
   {
      account_num num  = {};
      std::string name = {};

      auto key() { return num_to_name_key(num); }
   };
   EOSIO_REFLECT(num_to_name_row, num, name)

   inline auto name_to_num_key(const std::string& name)
   {
      return std::tuple{account_sys::contract, name_to_num_table, name};
   }
   struct name_to_num_row
   {
      account_num num  = {};
      std::string name = {};

      auto key() { return name_to_num_key(name); }
   };
   EOSIO_REFLECT(name_to_num_row, num, name)

   void register_acc(account_num_type num, const std::string& name)
   {
      if (enable_print)
         eosio::print("register ", num, " ", name, "\n");
      check(!name.empty(), "name is empty");  // TODO: better name constraints
      check(!kv_get_size(num_to_name_key(num)), "num already registered");
      check(!kv_get_size(name_to_num_key(name)), "name already registered");
      kv_put(num_to_name_key(num), num_to_name_row{num, name});
      kv_put(name_to_num_key(name), name_to_num_row{num, name});
   }

   void account_sys::startup(account_num_type                 next_account_n,
                             const_view<vector<account_name>> existing_accounts)
   {
      check(!kv_get<account_sys_status_row>(account_sys_status_key()), "already started");
      kv_put(account_sys_status_key(), account_sys_status_row{
                                           .next_account_num = next_account_n,
                                       });
      auto s = existing_accounts->size();
      eosio::print("existing accounts size: ", s, "\n");
      for (uint32_t i = 0; i < s; ++i)
      {
         auto r = existing_accounts[i];
         eosio::print((uint32_t)r->num(), " ", std::string_view(r->name()), "\n");
         register_acc(r->num(), r->name());
      }
   }

   account_num_type account_sys::create_account(const_view<string> name,
                                                const_view<string> auth_contract,
                                                bool               allow_sudo)
   {
      auto status = kv_get<account_sys_status_row>(account_sys_status_key());
      check(status.has_value(), "not started");
      write_console("auth con: ");
      write_console(auth_contract);
      auto auth_row = kv_get<name_to_num_row>(name_to_num_key(auth_contract));
      check(!!auth_row, "auth_contract not found");
      uint32_t flags = 0;

      // TODO: restrict ability to set this flag
      // TODO: support entire set of flags
      if (allow_sudo)
         flags |= account_row::allow_sudo;

      check(!kv_get<account_row>(account_row::kv_map, account_key(status->next_account_num)),
            "internal error: next_account_num already exists");

      account_row account{
          .num           = status->next_account_num++,
          .auth_contract = auth_row->num,
          .flags         = flags,
      };
      kv_put(status->key(), *status);
      kv_put(account.kv_map, account.key(), account);
      register_acc(account.num, name);
      return account.num;
   }

   optional<account_num_type> account_sys::get_account_by_name(const_view<string> name)
   {
      auto row = kv_get<name_to_num_row>(name_to_num_key(name));
      if (!!row)
         return row->num;
      return std::nullopt;
   }

   optional<string> account_sys::get_account_by_num(account_num_type num)
   {
      auto row = kv_get<num_to_name_row>(num_to_name_key(num));
      if (!!row)
         return row->name;
      return std::nullopt;
   }

   void account_sys::assert_account_name(account_num_type num, const_view<string> name)
   {
      auto os = get_account_by_num(num);
      check(!!os, "invalid account number");
      check(*os == std::string_view(name), "account name doesn't match number");
   }

   int64_t account_sys::exists(account_num_type num)
   {
      return (get_account_by_num(num) != std::nullopt) ? 1 : 0;
   }

}  // namespace psibase

PSIBASE_DISPATCH(psibase::account_sys)
