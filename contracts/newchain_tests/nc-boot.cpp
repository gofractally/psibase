#include "nc-boot.hpp"

using namespace newchain;

namespace boot
{
   account_num exec(account_num this_contract, account_num sender, create_account& args)
   {
      eosio::check(sender == boot::contract, "sender must be boot account");
      return newchain::create_account(args.auth_contract, args.privileged);
   }

   void exec(account_num this_contract, account_num sender, set_code& args)
   {
      eosio::check(sender == boot::contract, "sender must be boot account");
      newchain::set_code(args.contract, args.vm_type, args.vm_version, args.code);
   }

   extern "C" void called(account_num this_contract, account_num sender)
   {
      // printf("called this_contract=%d, sender=%d\n", this_contract, sender);
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

   extern "C" [[clang::export_name("auth")]] void auth(account_num this_contract)
   {
      // TODO: only unpack the needed fields
      auto act = get_current_action();
      // TODO: check keys of act.sender
      set_retval_bytes(call(act));
   }

   extern "C" void __wasm_call_ctors();
   extern "C" void start(account_num this_contract) { __wasm_call_ctors(); }
}  // namespace boot
