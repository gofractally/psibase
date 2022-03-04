#include <base_contracts/auth_fake_sys.hpp>
#include <base_contracts/transaction_sys.hpp>

#include <psibase/crypto.hpp>
#include <psibase/native_tables.hpp>

using namespace psibase;

static constexpr bool enable_print = false;

namespace transaction_sys
{
   // TODO: move to another contract
   void exec(account_num this_contract, account_num sender, set_code& args)
   {
      // TODO: validate code
      check(sender == args.contract, "sender must match contract account");
      auto account = kv_get<account_row>(account_row::kv_map, account_key(args.contract));
      check(account.has_value(), "can not set code on a missing account");
      auto code_hash = sha256(args.code.data(), args.code.size());
      if (args.vm_type == account->vm_type && args.vm_version == account->vm_version &&
          code_hash == account->code_hash)
         return;
      if (account->code_hash != eosio::checksum256{})
      {
         // TODO: Refund RAM? A different resource?
         auto code_obj = kv_get<code_row>(
             code_row::kv_map, code_key(account->code_hash, account->vm_type, account->vm_version));
         check(code_obj.has_value(), "missing code object");
         if (--code_obj->ref_count)
            kv_put(code_obj->kv_map, code_obj->key(), *code_obj);
         else
         {
            // TODO: erase code_obj
         }
      }

      // TODO: Bill RAM? A different resource?
      account->code_hash  = code_hash;
      account->vm_type    = args.vm_type;
      account->vm_version = args.vm_version;
      kv_put(account->kv_map, account->key(), *account);

      auto code_obj = kv_get<code_row>(
          code_row::kv_map, code_key(account->code_hash, account->vm_type, account->vm_version));
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
      kv_put(code_obj->kv_map, code_obj->key(), *code_obj);
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

   extern "C" [[clang::export_name("process_transaction")]] void process_transaction()
   {
      if (enable_print)
         eosio::print("process_transaction\n");
      // TODO: expiration
      // TODO: check ref_block_num, ref_block_prefix
      // TODO: check max_net_usage_words, max_cpu_usage_ms
      // TODO: resource billing
      // TODO: subjective mitigation hooks
      // TODO: limit execution time
      auto top_act = get_current_action();
      // TODO: avoid copying inner raw_data during unpack
      auto trx = eosio::convert_from_bin<transaction>(top_act.raw_data);
      for (auto& act : trx.actions)
      {
         auto account = kv_get<account_row>(account_row::kv_map, account_key(act.sender));
         check(!!account, "unknown sender");
         // TODO: assumes same dispatch format (abi) as auth_fake_sys
         // TODO: avoid inner raw_data copy
         // TODO: auth_contract needs a way to opt-in to being an auth contract.
         //       Otherwise, it may misunderstand the action, and worse,
         //       sender = 1, which provides transaction.sys's authorization
         //       for a potentially-unknown action.
         psibase::action outer = {
             .sender   = 1,
             .contract = account->auth_contract,
             .raw_data = eosio::convert_to_bin(auth_fake_sys::action{act}),
         };
         if (enable_print)
            eosio::print("call auth_check\n");
         call(outer);  // TODO: avoid copy (serializing outer)
         if (enable_print)
            eosio::print("call action\n");
         call(act);  // TODO: avoid copy (serializing)
      }
   }

   extern "C" void __wasm_call_ctors();
   extern "C" void start(account_num this_contract) { __wasm_call_ctors(); }
}  // namespace transaction_sys
