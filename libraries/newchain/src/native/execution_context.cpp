#include <eosio/vm/backend.hpp>
#include <newchain/action_context.hpp>
#include <newchain/db.hpp>

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
         throw std::runtime_error(e.detail());
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
      eosio::vm::wasm_allocator& wa;
      std::unique_ptr<backend_t> backend;
      bool                       initialized = false;
      action_context*            act_context = nullptr;

      execution_context_impl(transaction_context& trx_context,
                             execution_memory&    memory,
                             account_num          contract)
          : wa{memory.impl->wa}
      {
         auto& db      = trx_context.block_context.db;
         auto* account = db.db.find<account_object>(account_object::id_type(contract));
         eosio::check(account, "unknown contract account");
         auto* code = db.db.find<code_object, by_pk>(
             std::tuple{account->code_hash, account->vm_type, account->vm_version});
         eosio::check(code, "account has no code");
         std::vector<uint8_t> copy(
             reinterpret_cast<const uint8_t*>(code->code.data()),
             reinterpret_cast<const uint8_t*>(code->code.data() + code->code.size()));
         rethrow_vm_except([&] { backend = std::make_unique<backend_t>(copy, *this, nullptr); });
      }

      // TODO: configurable wasm limits
      void init(action_context& act_context)
      {
         this->act_context = &act_context;
         if (initialized)
            return;
         rethrow_vm_except([&] {
            backend->set_wasm_allocator(&wa);
            backend->initialize(this);
            (*backend)(*this, "env", "_start");
            initialized = true;
         });
      }

      void prints_l(span<const char> str)
      {
         // TODO
         std::cout.write(str.data(), str.size());
      }
   };

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
      rhf_t::add<&execution_context_impl::prints_l>("env", "prints_l");
   }

   void execution_context::exec(action_context& act_context)
   {
      impl->init(act_context);
      // TODO
      (*impl->backend)(*impl, "env", "test");
   }

}  // namespace newchain
