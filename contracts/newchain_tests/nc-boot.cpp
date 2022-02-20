#include "nc-boot.hpp"

#include <newchain/crypto.hpp>
#include <newchain/native_tables.hpp>

using namespace newchain;

namespace boot
{
   account_num exec(account_num this_contract, account_num sender, create_account& args)
   {
      // TODO: Bill RAM? A different resource?
      check(sender == boot::contract, "sender must be boot account");
      auto status = get_kv<status_row>(status_key());
      check(status.has_value(), "missing status");
      account_row account{
          .num           = status->next_account_num++,
          .auth_contract = args.auth_contract,
          .privileged    = args.privileged,
      };
      set_kv(status->key(), *status);
      set_kv(account.key(), account);
      return account.num;
   }  // create_account

   void exec(account_num this_contract, account_num sender, set_code& args)
   {
      // TODO: validate code
      check(sender == boot::contract, "sender must be boot account");
      auto account = get_kv<account_row>(account_key(args.contract));
      check(account.has_value(), "can not set code on a missing account");
      auto code_hash = sha256(args.code.data(), args.code.size());
      if (args.vm_type == account->vm_type && args.vm_version == account->vm_version &&
          code_hash == account->code_hash)
         return;
      if (account->code_hash != eosio::checksum256{})
      {
         // TODO: Refund RAM? A different resource?
         auto code_obj =
             get_kv<code_row>(code_key(account->code_hash, account->vm_type, account->vm_version));
         check(code_obj.has_value(), "missing code object");
         if (--code_obj->ref_count)
            set_kv(code_obj->key(), *code_obj);
         else
         {
            // TODO: erase code_obj
         }
      }

      // TODO: Bill RAM? A different resource?
      account->code_hash  = code_hash;
      account->vm_type    = args.vm_type;
      account->vm_version = args.vm_version;
      set_kv(account->key(), *account);

      auto code_obj =
          get_kv<code_row>(code_key(account->code_hash, account->vm_type, account->vm_version));
      if (!code_obj)
      {
         code_obj.emplace(code_row{
             .code_hash  = account->code_hash,
             .vm_type    = account->vm_type,
             .vm_version = account->vm_version,
         });
         code_obj->code.assign(args.code.begin(), args.code.end());
      }
      ++code_obj->ref_count;
      set_kv(code_obj->key(), *code_obj);
   }  // set_code

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
