#include "account.hpp"
#include "boot.hpp"

#include <psibase/native_tables.hpp>

using namespace psibase;

static constexpr bool enable_print = false;

namespace account
{
   using table_num = uint32_t;

   static constexpr table_num status_table      = 1;
   static constexpr table_num num_to_name_table = 2;
   static constexpr table_num name_to_num_table = 3;

   inline auto status_key() { return std::tuple{contract, status_table}; }
   struct status_row
   {
      psibase::account_num next_account_num = 0;

      static auto key() { return status_key(); }
   };
   EOSIO_REFLECT(status_row, next_account_num)

   inline auto num_to_name_key(account_num num)
   {
      return std::tuple{contract, num_to_name_table, num};
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
      return std::tuple{contract, name_to_num_table, name};
   }
   struct name_to_num_row
   {
      account_num num  = {};
      std::string name = {};

      auto key() { return name_to_num_key(name); }
   };
   EOSIO_REFLECT(name_to_num_row, num, name)

   void register_acc(psibase::account_num num, const std::string& name)
   {
      check(!name.empty(), "name is empty");  // TODO: better name constraints
      check(!kv_get_size(num_to_name_key(num)), "num already registered");
      check(!kv_get_size(name_to_num_key(name)), "name already registered");
      kv_set(num_to_name_key(num), num_to_name_row{num, name});
      kv_set(name_to_num_key(name), name_to_num_row{num, name});
   }

   void exec(account_num this_contract, account_num sender, startup& act)
   {
      check(!kv_get<status_row>(status_key()), "already started");
      kv_set(status_key(), status_row{
                               .next_account_num = act.next_account_num,
                           });
      for (auto [num, name] : act.existing_accounts)
         register_acc(num, name);
   }

   psibase::account_num exec(account_num this_contract, account_num sender, create_account& args)
   {
      auto status = kv_get<status_row>(status_key());
      check(status.has_value(), "not started");
      auto auth_row = kv_get<name_to_num_row>(name_to_num_key(args.auth_contract));
      check(!!auth_row, "auth_contract not found");
      uint32_t flags = 0;
      if (args.allow_sudo)
         flags |= account_row::allow_sudo;
      check(!kv_get<account_row>(account_row::kv_map, account_key(status->next_account_num)),
            "internal error: next_account_num already exists");
      account_row account{
          .num           = status->next_account_num++,
          .auth_contract = auth_row->num,
          .flags         = flags,
      };
      kv_set(status->key(), *status);
      kv_set(account.kv_map, account.key(), account);
      register_acc(account.num, args.name);
      return account.num;
   }

   std::optional<psibase::account_num> exec(account_num  this_contract,
                                            account_num  sender,
                                            get_by_name& args)
   {
      auto row = kv_get<name_to_num_row>(name_to_num_key(args.name));
      if (!!row)
         return row->num;
      return std::nullopt;
   }

   std::optional<std::string> exec(account_num this_contract, account_num sender, get_by_num& args)
   {
      auto row = kv_get<num_to_name_row>(num_to_name_key(args.num));
      if (!!row)
         return row->name;
      return std::nullopt;
   }

   extern "C" void called(account_num this_contract, account_num sender)
   {
      auto act  = get_current_action();
      auto data = eosio::convert_from_bin<action>(act.raw_data);
      std::visit(
          [&](auto& x) {
             if constexpr (std::is_same_v<decltype(exec(this_contract, sender, x)), void>)
                exec(this_contract, sender, x);
             else
                set_retval(exec(this_contract, sender, x));
          },
          data);
   }

   extern "C" void __wasm_call_ctors();
   extern "C" void start(account_num this_contract) { __wasm_call_ctors(); }
}  // namespace account
