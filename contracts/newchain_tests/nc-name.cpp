#include "nc-name.hpp"
#include "nc-boot.hpp"

using namespace newchain;

static constexpr bool enable_print = false;

namespace name
{
   using table_num = uint32_t;

   static constexpr account_num account           = 3;
   static constexpr table_num   num_to_name_table = 1;
   static constexpr table_num   name_to_num_table = 1;

   inline auto num_to_name_key(account_num num)
   {
      return std::tuple{account, num_to_name_table, num};
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
      return std::tuple{account, name_to_num_table, name};
   }
   struct name_to_num_row
   {
      account_num num  = {};
      std::string name = {};

      auto key() { return name_to_num_key(name); }
   };
   EOSIO_REFLECT(name_to_num_row, num, name)

   void register_acc(newchain::account_num num, const std::string& name)
   {
      check(!get_kv_size(num_to_name_key(num)), "num already registered");
      check(!get_kv_size(name_to_num_key(name)), "name already registered");
      set_kv(num_to_name_key(num), num_to_name_row{num, name});
      set_kv(name_to_num_key(name), name_to_num_row{num, name});
   }

   void exec(account_num this_contract, account_num sender, register_account& args)
   {
      register_acc(args.account, args.name);
   }

   newchain::account_num exec(account_num this_contract, account_num sender, create_account& args)
   {
      auto auth_row = get_kv<name_to_num_row>(name_to_num_key(args.auth_contract));
      check(!!auth_row, "auth_contract not found");
      auto num = boot::call(this_contract, boot::create_account{
                                               .auth_contract = auth_row->num,
                                               .privileged    = args.privileged,
                                           });
      register_acc(num, args.name);
      return num;
   }

   std::optional<newchain::account_num> exec(account_num  this_contract,
                                             account_num  sender,
                                             get_by_name& args)
   {
      auto row = get_kv<name_to_num_row>(name_to_num_key(args.name));
      if (!!row)
         return row->num;
      return std::nullopt;
   }

   std::optional<std::string> exec(account_num this_contract, account_num sender, get_by_num& args)
   {
      auto row = get_kv<num_to_name_row>(num_to_name_key(args.num));
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
}  // namespace name
