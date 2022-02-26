#include <newchain/execution_context.hpp>

#include <boost/multi_index/key.hpp>
#include <boost/multi_index/ordered_index.hpp>
#include <boost/multi_index/sequenced_index.hpp>
#include <boost/multi_index_container.hpp>
#include <eosio/vm/backend.hpp>
#include <mutex>
#include <newchain/action_context.hpp>
#include <newchain/db.hpp>
#include <newchain/from_bin.hpp>

namespace bmi = boost::multi_index;

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

   // Only useful for genesis
   void set_code(database&           db,
                 mdbx::txn_managed&  kv_trx,
                 account_num         contract,
                 uint8_t             vm_type,
                 uint8_t             vm_version,
                 eosio::input_stream code)
   {
      eosio::check(vm_type == 0, "vm_type is not 0");
      eosio::check(vm_version == 0, "vm_version is not 0");
      eosio::check(code.remaining(), "native set_code can't clear code");
      auto code_hash = sha256(code.pos, code.remaining());

      auto account = db.get_kv<account_row>(kv_trx, account_key(contract));
      eosio::check(account.has_value(), "set_code: unknown contract account");
      eosio::check(account->code_hash == eosio::checksum256{},
                   "native set_code can't replace code");
      account->code_hash  = code_hash;
      account->vm_type    = vm_type;
      account->vm_version = vm_version;
      db.set_kv(kv_trx, account->key(), *account);

      auto code_obj = db.get_kv<code_row>(kv_trx, code_key(code_hash, vm_type, vm_version));
      if (!code_obj)
      {
         code_obj.emplace();
         code_obj->code_hash  = code_hash;
         code_obj->vm_type    = vm_type;
         code_obj->vm_version = vm_version;
         code_obj->code.assign(code.pos, code.end);
      }
      ++code_obj->ref_count;
      db.set_kv(kv_trx, code_obj->key(), *code_obj);
   }  // set_code

   struct backend_entry
   {
      eosio::checksum256         hash;
      std::unique_ptr<backend_t> backend;
   };

   struct by_age;
   struct by_hash;

   using backend_container = bmi::multi_index_container<
       backend_entry,
       bmi::indexed_by<bmi::sequenced<bmi::tag<by_age>>,
                       bmi::ordered_non_unique<bmi::tag<by_hash>, bmi::key<&backend_entry::hash>>>>;

   struct wasm_cache_impl
   {
      std::mutex        mutex;
      uint32_t          cache_size;
      backend_container backends;

      wasm_cache_impl(uint32_t cache_size) : cache_size{cache_size} {}

      void add(backend_entry&& entry)
      {
         std::lock_guard<std::mutex> lock{mutex};
         auto&                       ind = backends.get<by_age>();
         ind.push_back(std::move(entry));
         while (ind.size() > cache_size)
            ind.pop_front();
      }

      std::unique_ptr<backend_t> get(const eosio::checksum256& hash)
      {
         std::unique_ptr<backend_t>  result;
         std::lock_guard<std::mutex> lock{mutex};
         auto&                       ind = backends.get<by_hash>();
         auto                        it  = ind.find(hash);
         if (it == ind.end())
            return result;
         ind.modify(it, [&](auto& x) { result = std::move(x.backend); });
         ind.erase(it);
         return result;
      }
   };

   wasm_cache::wasm_cache(uint32_t cache_size) : impl{std::make_shared<wasm_cache_impl>(cache_size)}
   {
   }

   wasm_cache::wasm_cache(const wasm_cache& src) : impl{src.impl} {}

   wasm_cache::wasm_cache(wasm_cache&& src) : impl{std::move(src.impl)} {}

   wasm_cache::~wasm_cache() {}

   struct execution_memory_impl
   {
      eosio::vm::wasm_allocator wa;
   };

   std::unique_ptr<execution_memory_impl> impl;

   execution_memory::execution_memory() { impl = std::make_unique<execution_memory_impl>(); }
   execution_memory::execution_memory(execution_memory&& src) { impl = std::move(src.impl); }
   execution_memory::~execution_memory() {}

   // TODO: debugger
   struct execution_context_impl
   {
      database&                  db;
      transaction_context&       trx_context;
      eosio::vm::wasm_allocator& wa;
      std::unique_ptr<backend_t> backend;
      account_row                contract_account;
      bool                       initialized         = false;
      action_context*            current_act_context = nullptr;  // Changes during recursion

      execution_context_impl(transaction_context& trx_context,
                             execution_memory&    memory,
                             account_num          contract)
          : db{trx_context.block_context.db}, trx_context{trx_context}, wa{memory.impl->wa}
      {
         auto ca = db.get_kv<account_row>(*trx_context.kv_trx, account_key(contract));
         eosio::check(ca.has_value(), "unknown contract account");
         eosio::check(ca->code_hash != eosio::checksum256{}, "account has no code");
         contract_account = std::move(*ca);
         auto code        = db.get_kv<code_row>(
             *trx_context.kv_trx, code_key(contract_account.code_hash, contract_account.vm_type,
                                           contract_account.vm_version));
         eosio::check(code.has_value(), "code record is missing");
         rethrow_vm_except([&] {
            backend = trx_context.block_context.system_context.wasm_cache.impl->get(
                contract_account.code_hash);
            if (!backend)
               backend = std::make_unique<backend_t>(code->code, nullptr);
         });
      }

      ~execution_context_impl()
      {
         trx_context.block_context.system_context.wasm_cache.impl->add(
             {contract_account.code_hash, std::move(backend)});
      }

      // TODO: configurable wasm limits
      void init()
      {
         rethrow_vm_except([&] {
            backend->set_wasm_allocator(&wa);
            backend->initialize(this);
            (*backend)(*this, "env", "start", (uint32_t)current_act_context->action.contract);
            initialized = true;
         });
      }

      template <typename F>
      void exec(action_context& act_context, F f)
      {
         auto prev           = current_act_context;
         current_act_context = &act_context;
         if (!initialized)
            init();
         rethrow_vm_except(f);
         current_act_context = prev;
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
         if (++current_act_context->transaction_context.call_depth > 6)
            eosio::check(false, "call depth exceeded (temporary rule)");

         // TODO: don't unpack raw_data
         auto act = unpack_all<action>({data.data(), data.size()}, "extra data in call");
         if (act.sender != contract_account.num)
         {
            auto sender = db.get_kv<account_row>(*trx_context.kv_trx, account_key(act.sender));
            eosio::check(sender.has_value(), "unknown sender account");
            eosio::check(
                sender->auth_contract == contract_account.num || contract_account.privileged,
                "contract is not authorized to call as sender");
         }

         current_act_context->action_trace.inner_traces.push_back({action_trace{}});
         auto& inner_action_trace =
             std::get<action_trace>(current_act_context->action_trace.inner_traces.back().inner);
         // TODO: avoid reserialization
         current_act_context->transaction_context.exec_called_action(act, inner_action_trace);
         result = inner_action_trace.retval;

         --current_act_context->transaction_context.call_depth;
         return result.size();
      }

      void set_retval(span<const char> data)
      {
         current_act_context->action_trace.retval.assign(data.begin(), data.end());
      }

      // TODO: track consumption
      // TODO: restrict key size
      // TODO: restrict value size
      // TODO: restrict contracts writing to other contracts' regions
      void set_kv(span<const char> key, span<const char> value)
      {
         trx_context.kv_trx->upsert(db.kv_map, {key.data(), key.size()},
                                    {value.data(), value.size()});
      }

      // TODO: avoid copying value to result
      uint32_t get_kv(span<const char> key)
      {
         mdbx::slice k{key.data(), key.size()};
         mdbx::slice v;
         auto        stat = ::mdbx_get(*trx_context.kv_trx, db.kv_map, &k, &v);
         if (stat == MDBX_NOTFOUND)
            return -1;
         mdbx::error::success_or_throw(stat);
         result.assign((const char*)v.data(), (const char*)v.data() + v.length());
         return result.size();
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
      rhf_t::add<&execution_context_impl::set_kv>("env", "set_kv");
      rhf_t::add<&execution_context_impl::get_kv>("env", "get_kv");
   }

   void execution_context::exec_process_transaction(action_context& act_context)
   {
      impl->exec(act_context, [&] {  //
         (*impl->backend)(*impl, "env", "process_transaction");
      });
   }

   void execution_context::exec_called(action_context& act_context)
   {
      impl->exec(act_context, [&] {  //
         (*impl->backend)(*impl, "env", "called", (uint32_t)act_context.action.contract,
                          (uint32_t)act_context.action.sender);
      });
   }

   void execution_context::exec_rpc(action_context& act_context)
   {
      impl->exec(act_context, [&] {  //
         (*impl->backend)(*impl, "env", "rpc");
      });
   }
}  // namespace newchain
