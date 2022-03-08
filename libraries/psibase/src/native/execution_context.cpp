#include <psibase/execution_context.hpp>

#include <boost/multi_index/key.hpp>
#include <boost/multi_index/ordered_index.hpp>
#include <boost/multi_index/sequenced_index.hpp>
#include <boost/multi_index_container.hpp>
#include <eosio/vm/backend.hpp>
#include <mutex>
#include <psibase/action_context.hpp>
#include <psibase/db.hpp>
#include <psibase/from_bin.hpp>

namespace bmi = boost::multi_index;

using eosio::vm::span;

namespace psibase
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
                 account_num         contract,
                 uint8_t             vm_type,
                 uint8_t             vm_version,
                 eosio::input_stream code)
   {
      eosio::check(code.remaining(), "native set_code can't clear code");
      auto code_hash = sha256(code.pos, code.remaining());

      auto account = db.kv_get<account_row>(account_row::kv_map, account_key(contract));
      eosio::check(account.has_value(), "set_code: unknown contract account");
      eosio::check(account->code_hash == eosio::checksum256{},
                   "native set_code can't replace code");
      account->code_hash  = code_hash;
      account->vm_type    = vm_type;
      account->vm_version = vm_version;
      db.kv_put(account_row::kv_map, account->key(), *account);

      auto code_obj =
          db.kv_get<code_row>(code_row::kv_map, code_key(code_hash, vm_type, vm_version));
      if (!code_obj)
      {
         code_obj.emplace();
         code_obj->code_hash  = code_hash;
         code_obj->vm_type    = vm_type;
         code_obj->vm_version = vm_version;
         code_obj->code.assign(code.pos, code.end);
      }
      ++code_obj->ref_count;
      db.kv_put(code_row::kv_map, code_obj->key(), *code_obj);
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
         auto ca = db.kv_get<account_row>(account_row::kv_map, account_key(contract));
         eosio::check(ca.has_value(), "unknown contract account");
         eosio::check(ca->code_hash != eosio::checksum256{}, "account has no code");
         contract_account = std::move(*ca);
         auto code        = db.kv_get<code_row>(
             code_row::kv_map, code_key(contract_account.code_hash, contract_account.vm_type,
                                        contract_account.vm_version));
         eosio::check(code.has_value(), "code record is missing");
         eosio::check(code->vm_type == 0, "vm_type is not 0");
         eosio::check(code->vm_version == 0, "vm_version is not 0");
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
            // auto start_time = std::chrono::steady_clock::now();
            backend->set_wasm_allocator(&wa);
            backend->initialize(this);
            (*backend)(*this, "env", "start", (uint32_t)current_act_context->action.contract);
            initialized = true;
            // auto us     = std::chrono::duration_cast<std::chrono::microseconds>(
            //     std::chrono::steady_clock::now() - start_time);
            // std::cout << "init:   " << us.count() << " us\n";
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

      kv_map get_map_read(uint32_t map)
      {
         if (map == uint32_t(kv_map::contract))
            return (kv_map)map;
         if (map == uint32_t(kv_map::native_constrained))
            return (kv_map)map;
         if (map == uint32_t(kv_map::native_unconstrained))
            return (kv_map)map;
         if (map == uint32_t(kv_map::subjective))
         {
            // TODO: RPC contract queries currently can read subjective data to monitor node status.
            //       However, there's a possibility this may make it easier on an active attacker.
            //       Make this capability a node configuration toggle? Allow node config to whitelist
            //       contracts for this?
            if ((contract_account.flags & account_row::is_subjective) ||
                trx_context.block_context.is_read_only)
               return (kv_map)map;
         }
         throw std::runtime_error("contract may not read this map");
      }

      kv_map get_map_write(uint32_t map, eosio::input_stream key)
      {
         eosio::check(!trx_context.block_context.is_read_only, "writes disabled during query");

         if (map == uint32_t(kv_map::subjective) &&
             (contract_account.flags & account_row::is_subjective))
            return (kv_map)map;

         // Prevent poison block; subjective contracts skip execution while not in production
         eosio::check(!(contract_account.flags & account_row::is_subjective),
                      "subjective contracts may only write to kv_map::subjective");

         if (map == uint32_t(kv_map::contract))
         {
            uint32_t prefix = contract_account.num;
            std::reverse(reinterpret_cast<char*>(&prefix), reinterpret_cast<char*>(&prefix + 1));
            eosio::check(
                key.remaining() >= sizeof(prefix) && !memcmp(key.pos, &prefix, sizeof(prefix)),
                "key prefix must match contract during write");
            return (kv_map)map;
         }
         if (map == uint32_t(kv_map::native_constrained) &&
             (contract_account.flags & account_row::allow_write_native))
            return (kv_map)map;
         if (map == uint32_t(kv_map::native_unconstrained) &&
             (contract_account.flags & account_row::allow_write_native))
            return (kv_map)map;
         throw std::runtime_error("contract may not write this map");
      }

      void verify_write_constrained(eosio::input_stream key, eosio::input_stream value)
      {
         // Only the code table currently lives in native_constrained
         auto code = eosio::from_bin<code_row>(value);
         eosio::check(!value.remaining(), "extra data after code_row");
         auto code_hash = sha256(code.code.data(), code.code.size());
         eosio::check(code.code_hash == code_hash, "code_row has incorrect code_hash");
         auto expected_key = eosio::convert_to_key(code.key());
         eosio::check(key.remaining() == expected_key.size() &&
                          !memcmp(key.pos, expected_key.data(), key.remaining()),
                      "code_row has incorrect key");
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

      uint32_t call(span<const char> data)
      {
         // TODO: replace temporary rule
         if (++current_act_context->transaction_context.call_depth > 6)
            eosio::check(false, "call depth exceeded (temporary rule)");

         // TODO: don't unpack raw_data
         auto act = unpack_all<action>({data.data(), data.size()}, "extra data in call");
         eosio::check(act.sender == contract_account.num ||
                          (contract_account.flags & account_row::allow_sudo),
                      "contract is not authorized to call as another sender");

         current_act_context->action_trace.inner_traces.push_back({action_trace{}});
         auto& inner_action_trace =
             std::get<action_trace>(current_act_context->action_trace.inner_traces.back().inner);
         // TODO: avoid reserialization
         current_act_context->transaction_context.exec_called_action(contract_account.flags, act,
                                                                     inner_action_trace);
         result = inner_action_trace.raw_retval;

         --current_act_context->transaction_context.call_depth;
         return result.size();
      }

      void set_retval(span<const char> data)
      {
         // TODO: record return values of top-most subjective calls in block
         eosio::check(!(contract_account.flags & account_row::is_subjective),
                      "set_retval not implemented for subjective contracts");
         current_act_context->action_trace.raw_retval.assign(data.begin(), data.end());
      }

      // TODO: track consumption
      // TODO: restrict key size
      // TODO: restrict value size
      // TODO: don't let timer abort db operation
      void kv_put(uint32_t map, span<const char> key, span<const char> value)
      {
         if (map == uint32_t(kv_map::native_constrained))
            verify_write_constrained({key.data(), key.size()}, {value.data(), value.size()});
         result.clear();
         db.kv_put_raw(get_map_write(map, {key.data(), key.size()}), {key.data(), key.size()},
                       {value.data(), value.size()});
      }

      // TODO: track consumption
      // TODO: don't let timer abort db operation
      void kv_remove(uint32_t map, span<const char> key)
      {
         result.clear();
         db.kv_remove_raw(get_map_write(map, {key.data(), key.size()}), {key.data(), key.size()});
      }

      // TODO: avoid copying value to result
      // TODO: don't let timer abort db operation
      uint32_t kv_get(uint32_t map, span<const char> key)
      {
         result.clear();
         auto v = db.kv_get_raw(get_map_read(map), {key.data(), key.size()});
         if (!v)
            return -1;
         result.assign(v->pos, v->end);
         return result.size();
      }

      // TODO: avoid copying value to result
      // TODO: don't let timer abort db operation
      uint32_t kv_greater_equal(uint32_t map, span<const char> key, uint32_t match_key_size)
      {
         eosio::check(match_key_size <= key.size(), "match_key_size is larger than key");
         result.clear();
         auto v =
             db.kv_greater_equal_raw(get_map_read(map), {key.data(), key.size()}, match_key_size);
         if (!v)
            return -1;
         result.assign(v->pos, v->end);
         return result.size();
      }

      // TODO: avoid copying value to result
      // TODO: don't let timer abort db operation
      uint32_t kv_less_than(uint32_t map, span<const char> key, uint32_t match_key_size)
      {
         eosio::check(match_key_size <= key.size(), "match_key_size is larger than key");
         result.clear();
         auto v = db.kv_less_than_raw(get_map_read(map), {key.data(), key.size()}, match_key_size);
         if (!v)
            return -1;
         result.assign(v->pos, v->end);
         return result.size();
      }

      // TODO: avoid copying value to result
      // TODO: don't let timer abort db operation
      uint32_t kv_max(uint32_t map, span<const char> key)
      {
         result.clear();
         auto v = db.kv_max_raw(get_map_read(map), {key.data(), key.size()});
         if (!v)
            return -1;
         result.assign(v->pos, v->end);
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
      rhf_t::add<&execution_context_impl::kv_put>("env", "kv_put");
      rhf_t::add<&execution_context_impl::kv_remove>("env", "kv_remove");
      rhf_t::add<&execution_context_impl::kv_get>("env", "kv_get");
      rhf_t::add<&execution_context_impl::kv_greater_equal>("env", "kv_greater_equal");
      rhf_t::add<&execution_context_impl::kv_less_than>("env", "kv_less_than");
      rhf_t::add<&execution_context_impl::kv_max>("env", "kv_max");
   }

   void execution_context::exec_process_transaction(action_context& act_context)
   {
      impl->exec(act_context, [&] {  //
         (*impl->backend)(*impl, "env", "process_transaction");
      });
   }

   void execution_context::exec_called(uint64_t caller_flags, action_context& act_context)
   {
      // Prevents a poison block
      if (!(impl->contract_account.flags & account_row::is_subjective))
         eosio::check(!(caller_flags & account_row::is_subjective),
                      "subjective contracts may not call non-subjective ones");

      impl->exec(act_context, [&] {  //
         (*impl->backend)(*impl, "env", "called", (uint32_t)act_context.action.contract,
                          (uint32_t)act_context.action.sender);
      });
   }

   void execution_context::exec_verify(action_context& act_context)
   {
      impl->exec(act_context, [&] {  //
         // auto start_time = std::chrono::steady_clock::now();
         (*impl->backend)(*impl, "env", "verify");
         // auto us = std::chrono::duration_cast<std::chrono::microseconds>(
         //     std::chrono::steady_clock::now() - start_time);
         // std::cout << "verify: " << us.count() << " us\n";
      });
   }

   void execution_context::exec_rpc(action_context& act_context)
   {
      impl->exec(act_context, [&] {  //
         (*impl->backend)(*impl, "env", "rpc");
      });
   }
}  // namespace psibase
