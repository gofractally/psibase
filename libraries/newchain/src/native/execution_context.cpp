#include <newchain/execution_context.hpp>

#include <eosio/vm/backend.hpp>
#include <newchain/action_context.hpp>
#include <newchain/db.hpp>
#include <newchain/from_bin.hpp>

using eosio::vm::span;

namespace newchain
{
   struct execution_context_impl;
   using rhf_t     = eosio::vm::registered_host_functions<execution_context_impl>;
   using backend_t = eosio::vm::backend<rhf_t, eosio::vm::jit>;

   // Rethrow with detailed info
   template <typename F>
   void rethrow_vm_except(F f)
   {
      try
      {
         f();
      }
      catch (const eosio::vm::exception& e)
      {
         throw std::runtime_error(std::string(e.what()) + ": " + e.detail());
      }
   }

   void set_code(database&           db,
                 account_num         contract,
                 uint8_t             vm_type,
                 uint8_t             vm_version,
                 eosio::input_stream code)
   {
      eosio::check(vm_type == 0, "vm_type is not 0");
      eosio::check(vm_version == 0, "vm_version is not 0");
      eosio::checksum256 code_hash;
      if (code.remaining())
         code_hash = sha256(code.pos, code.remaining());

      auto* account = db.db.find<account_object>(account_object::id_type(contract));
      eosio::check(account, "unknown contract account");
      if (account->code_hash == code_hash && account->vm_type == vm_type &&
          account->vm_version == vm_version)
         return;

      if (account->code_hash != eosio::checksum256{})
      {
         // TODO: refund RAM
         auto* code_obj = db.db.find<code_object, by_pk>(
             std::tuple{account->code_hash, account->vm_type, account->vm_version});
         eosio::check(code_obj, "code is missing");
         if (code_obj->ref_count == 1)
            db.db.remove(*code_obj);
         else
            db.db.modify(*code_obj, [](auto& code_obj) { --code_obj.ref_count; });
      }

      db.db.modify(*account, [&](auto& account) {
         // TODO: charge RAM if code is not empty
         account.code_hash  = code_hash;
         account.vm_type    = vm_type;
         account.vm_version = vm_version;
      });

      if (code.remaining())
      {
         // TODO: check code
         auto* code_obj =
             db.db.find<code_object, by_pk>(std::tuple{code_hash, vm_type, vm_version});
         if (code_obj)
            db.db.modify(*code_obj, [](auto& code_obj) { ++code_obj.ref_count; });
         else
            db.db.create<code_object>([&](auto& code_obj) {
               code_obj.ref_count  = 1;
               code_obj.code_hash  = code_hash;
               code_obj.vm_type    = vm_type;
               code_obj.vm_version = vm_version;
               code_obj.code.assign(code.pos, code.remaining());
            });
      }
   }  // set_code

   struct execution_memory_impl
   {
      eosio::vm::wasm_allocator wa;
   };

   std::unique_ptr<execution_memory_impl> impl;

   execution_memory::execution_memory() { impl = std::make_unique<execution_memory_impl>(); }
   execution_memory::execution_memory(execution_memory&& src) { impl = std::move(src.impl); }
   execution_memory::~execution_memory() {}

   // TODO: cache backend?
   // TODO: debugger
   struct execution_context_impl
   {
      database&                  db;
      eosio::vm::wasm_allocator& wa;
      std::unique_ptr<backend_t> backend;
      const account_object*      contract_account;
      bool                       initialized         = false;
      action_context*            current_act_context = nullptr;  // Changes during recursion

      execution_context_impl(transaction_context& trx_context,
                             execution_memory&    memory,
                             account_num          contract)
          : db{trx_context.block_context.db}, wa{memory.impl->wa}
      {
         contract_account = db.db.find<account_object>(account_object::id_type(contract));
         eosio::check(contract_account, "unknown contract account");
         auto* code = db.db.find<code_object, by_pk>(std::tuple{
             contract_account->code_hash, contract_account->vm_type, contract_account->vm_version});
         eosio::check(code, "account has no code");
         std::vector<uint8_t> copy(
             reinterpret_cast<const uint8_t*>(code->code.data()),
             reinterpret_cast<const uint8_t*>(code->code.data() + code->code.size()));
         rethrow_vm_except([&] { backend = std::make_unique<backend_t>(copy, *this, nullptr); });
      }

      // TODO: configurable wasm limits
      void init()
      {
         if (initialized)
            return;
         rethrow_vm_except([&] {
            backend->set_wasm_allocator(&wa);
            backend->initialize(this);
            (*backend)(*this, "env", "start", (uint32_t)current_act_context->action.contract);
            initialized = true;
         });
      }

      std::vector<char> result;

      // TODO: offset
      uint32_t get_result(span<char> dest)
      {
         if (!result.empty())
            memcpy(dest.data(), result.data(), std::min(result.size(), dest.size()));
         return result.size();
      }

      void write_console(span<const char> str)
      {
         // TODO: limit total console size across all executions within transaction
         if (current_act_context->action_trace.inner_traces.empty() ||
             !std::holds_alternative<console_trace>(
                 current_act_context->action_trace.inner_traces.back().inner))
            current_act_context->action_trace.inner_traces.push_back({console_trace{}});
         auto& console =
             std::get<console_trace>(current_act_context->action_trace.inner_traces.back().inner)
                 .console;
         console.append(str.begin(), str.end());
      }

      void abort_message(span<const char> str)
      {
         throw std::runtime_error("contract aborted with message: " +
                                  std::string(str.data(), str.size()));
      }

      uint32_t get_current_action()
      {
         result = eosio::convert_to_bin(current_act_context->action);
         return result.size();
      }

      // TODO: should privileged be able to sudo a deleted account? Might be needed
      //       to roll back attacks. OTOH, might confuse contracts which look up the
      //       sender account. Maybe support undelete instead?
      uint32_t call(span<const char> data)
      {
         // TODO: replace temporary rule
         if (++current_act_context->transaction_context.call_depth > 4)
            eosio::check(false, "call depth exceeded (temporary rule)");

         auto act = unpack_all<action>({data.data(), data.size()}, "extra data in call");
         if (act.sender != contract_account->id)
         {
            auto* sender = db.db.find<account_object>(account_object::id_type(act.sender));
            eosio::check(sender, "unknown sender account");
            eosio::check(
                sender->auth_contract == contract_account->id || contract_account->privileged,
                "contract is not authorized to call as sender");
         }

         current_act_context->action_trace.inner_traces.push_back({action_trace{}});
         auto& inner_action_trace =
             std::get<action_trace>(current_act_context->action_trace.inner_traces.back().inner);
         current_act_context->transaction_context.exec_called_action(act, inner_action_trace);
         result = inner_action_trace.retval;

         --current_act_context->transaction_context.call_depth;
         return result.size();
      }

      void set_retval(span<const char> data)
      {
         current_act_context->action_trace.retval.assign(data.begin(), data.end());
      }

      account_num create_account(account_num auth_contract, bool privileged)
      {
         eosio::check(contract_account->privileged,
                      "contract is not authorized to use create_account");
         auto id = db.db
                       .create<account_object>([&](auto& obj) {
                          obj.auth_contract = auth_contract;
                          obj.privileged    = privileged;
                       })
                       .id._id;
         auto* a = db.db.find<account_object>(account_object::id_type(auth_contract));
         eosio::check(a, "auth_contract is not a valid account");
         return id;
      }

      void set_code(account_num      contract,
                    uint32_t         vm_type,
                    uint32_t         vm_version,
                    span<const char> code)
      {
         eosio::check(contract_account->privileged, "contract is not authorized to use set_code");
         eosio::check(vm_type == uint8_t(vm_type), "vm_type out of range");
         eosio::check(vm_version == uint8_t(vm_version), "vm_version out of range");
         newchain::set_code(db, contract, vm_type, vm_version, {code.data(), code.size()});
      }
   };  // execution_context_impl

   execution_context::execution_context(transaction_context& trx_context,
                                        execution_memory&    memory,
                                        account_num          contract)
   {
      impl = std::make_unique<execution_context_impl>(trx_context, memory, contract);
   }

   execution_context::execution_context(execution_context&& src) { impl = std::move(src.impl); }
   execution_context::~execution_context() {}

   void execution_context::register_host_functions()
   {
      rhf_t::add<&execution_context_impl::get_result>("env", "get_result");
      rhf_t::add<&execution_context_impl::write_console>("env", "write_console");
      rhf_t::add<&execution_context_impl::abort_message>("env", "abort_message");
      rhf_t::add<&execution_context_impl::get_current_action>("env", "get_current_action");
      rhf_t::add<&execution_context_impl::call>("env", "call");
      rhf_t::add<&execution_context_impl::set_retval>("env", "set_retval");
      rhf_t::add<&execution_context_impl::create_account>("env", "create_account");
      rhf_t::add<&execution_context_impl::set_code>("env", "set_code");
   }

   void execution_context::exec(action_context& act_context, bool is_auth)
   {
      auto prev                 = impl->current_act_context;
      impl->current_act_context = &act_context;

      impl->init();
      rethrow_vm_except([&] {
         if (is_auth)
            (*impl->backend)(*impl, "env", "auth", (uint32_t)act_context.action.contract);
         else
            (*impl->backend)(*impl, "env", "called", (uint32_t)act_context.action.contract,
                             (uint32_t)act_context.action.sender);
      });

      impl->current_act_context = prev;
   }

}  // namespace newchain
