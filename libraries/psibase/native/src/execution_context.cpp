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
      eosio::check(account->code_hash == Checksum256{}, "native set_code can't replace code");
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
      Checksum256                hash;
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

      std::unique_ptr<backend_t> get(const Checksum256& hash)
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

   execution_memory::execution_memory()
   {
      impl = std::make_unique<execution_memory_impl>();
   }
   execution_memory::execution_memory(execution_memory&& src)
   {
      impl = std::move(src.impl);
   }
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
         eosio::check(ca->code_hash != Checksum256{}, "account has no code");
         contract_account = std::move(*ca);
         auto code        = db.kv_get<code_row>(
             code_row::kv_map, code_key(contract_account.code_hash, contract_account.vm_type,
                                               contract_account.vm_version));
         eosio::check(code.has_value(), "code record is missing");
         eosio::check(code->vm_type == 0, "vm_type is not 0");
         eosio::check(code->vm_version == 0, "vm_version is not 0");
         rethrow_vm_except(
             [&]
             {
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
         rethrow_vm_except(
             [&]
             {
                // auto start_time = std::chrono::steady_clock::now();
                backend->set_wasm_allocator(&wa);
                backend->initialize(this);
                (*backend)(*this, "env", "start", current_act_context->action.contract.value);
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
         if (map == uint32_t(kv_map::write_only) && trx_context.block_context.is_read_only)
            return (kv_map)map;
         if (map == uint32_t(kv_map::block_log) && trx_context.block_context.is_read_only)
            return (kv_map)map;
         throw std::runtime_error("contract may not read this map, or must use another intrinsic");
      }

      kv_map get_map_read_sequential(uint32_t map)
      {
         if (map == uint32_t(kv_map::event) && trx_context.block_context.is_read_only)
            return (kv_map)map;
         if (map == uint32_t(kv_map::ui_event) && trx_context.block_context.is_read_only)
            return (kv_map)map;
         throw std::runtime_error("contract may not read this map, or must use another intrinsic");
      }

      bool key_has_contract_prefix(uint32_t map) { return map == uint32_t(kv_map::contract); }

      kv_map get_map_write(uint32_t map, eosio::input_stream key)
      {
         eosio::check(!trx_context.block_context.is_read_only, "writes disabled during query");

         if (map == uint32_t(kv_map::subjective) &&
             (contract_account.flags & account_row::is_subjective))
            return (kv_map)map;

         // Prevent poison block; subjective contracts skip execution while not in production
         eosio::check(!(contract_account.flags & account_row::is_subjective),
                      "subjective contracts may only write to kv_map::subjective");

         if (map == uint32_t(kv_map::contract) || map == uint32_t(kv_map::write_only))
         {
            uint64_t prefix = contract_account.num.value;
            // TODO DAN: remove this later...
            // TODO TODD: Commenting this out and adding the special overload to_key(AccountNumber)
            //            causes kv sort order and AccountNumber::operator<=>() to disagree. This will
            //            cause nasty headaches for someone.
            //std::reverse(reinterpret_cast<char*>(&prefix), reinterpret_cast<char*>(&prefix + 1));
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
         throw std::runtime_error("contract may not write this map, or must use another intrinsic");
      }

      kv_map get_map_write_sequential(uint32_t map)
      {
         eosio::check(!trx_context.block_context.is_read_only, "writes disabled during query");

         if (map == uint32_t(kv_map::event))
            return (kv_map)map;
         if (map == uint32_t(kv_map::ui_event))
            return (kv_map)map;
         throw std::runtime_error("contract may not write this map, or must use another intrinsic");
      }

      void verify_write_constrained(eosio::input_stream key, eosio::input_stream value)
      {
         // Currently, code is the only table which lives in native_constrained
         // which is writable by contracts. The other tables aren't writable by
         // contracts.
         //
         // TODO: use a view here instead of unpacking to a rich object
         // TODO: verify fracpack; no unknown
         auto code = psio::convert_from_frac<code_row>(psio::input_stream(value.pos, value.end));
         auto code_hash = sha256(code.code.data(), code.code.size());
         eosio::check(code.code_hash == code_hash, "code_row has incorrect code_hash");
         auto expected_key = eosio::convert_to_key(code.key());
         eosio::check(key.remaining() == expected_key.size() &&
                          !memcmp(key.pos, expected_key.data(), key.remaining()),
                      "code_row has incorrect key");
      }

      std::vector<char> result_key;
      std::vector<char> result_value;

      uint32_t clear_result()
      {
         result_key.clear();
         result_value.clear();
         return -1;
      }

      uint32_t set_result(std::vector<char> result)
      {
         result_key.clear();
         result_value = std::move(result);
         return result_value.size();
      }

      uint32_t set_result(const std::optional<eosio::input_stream>& o)
      {
         if (!o)
            return clear_result();
         result_key.clear();
         result_value.assign(o->pos, o->end);
         return result_value.size();
      }

      uint32_t set_result(const std::optional<database::kv_result>& o)
      {
         if (!o)
            return clear_result();
         result_key.assign(o->key.pos, o->key.end);
         result_value.assign(o->value.pos, o->value.end);
         return result_value.size();
      }

      // TODO: offset
      uint32_t get_result(span<char> dest)
      {
         if (!result_value.empty())
            memcpy(dest.data(), result_value.data(), std::min(result_value.size(), dest.size()));
         return result_value.size();
      }

      uint32_t get_key(span<char> dest)
      {
         if (!result_key.empty())
            memcpy(dest.data(), result_key.data(), std::min(result_key.size(), dest.size()));
         return result_key.size();
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
         clear_result();
      }

      void abort_message(span<const char> str)
      {
         throw std::runtime_error("contract " + contract_account.num.str() +
                                  " aborted with message: " + std::string(str.data(), str.size()));
      }

      uint32_t get_current_action()
      {
         return set_result(psio::convert_to_frac(current_act_context->action));
      }

      uint32_t call(span<const char> data)
      {
         // TODO: replace temporary rule
         if (++current_act_context->transaction_context.call_depth > 6)
            eosio::check(false, "call depth exceeded (temporary rule)");

         // TODO: don't unpack raw_data
         eosio::check(psio::fracvalidate<action>(data.data(), data.end()).valid_and_known(),
                      "call: invalid data format");
         auto act = psio::convert_from_frac<action>({data.data(), data.size()});
         eosio::check(act.sender == contract_account.num ||
                          (contract_account.flags & account_row::allow_sudo),
                      "contract is not authorized to call as another sender");

         current_act_context->action_trace.inner_traces.push_back({action_trace{}});
         auto& inner_action_trace =
             std::get<action_trace>(current_act_context->action_trace.inner_traces.back().inner);
         // TODO: avoid reserialization
         current_act_context->transaction_context.exec_called_action(contract_account.flags, act,
                                                                     inner_action_trace);
         set_result(inner_action_trace.raw_retval);

         --current_act_context->transaction_context.call_depth;
         return result_value.size();
      }

      void set_retval(span<const char> data)
      {
         // TODO: record return values of top-most subjective calls in block
         eosio::check(!(contract_account.flags & account_row::is_subjective),
                      "set_retval not implemented for subjective contracts");
         current_act_context->action_trace.raw_retval.assign(data.begin(), data.end());
         clear_result();
      }

      // TODO: track consumption
      // TODO: restrict key size
      // TODO: restrict value size
      // TODO: don't let timer abort db operation
      void kv_put(uint32_t map, span<const char> key, span<const char> value)
      {
         if (map == uint32_t(kv_map::native_constrained))
            verify_write_constrained({key.data(), key.size()}, {value.data(), value.size()});
         clear_result();
         db.kv_put_raw(get_map_write(map, {key.data(), key.size()}), {key.data(), key.size()},
                       {value.data(), value.size()});
      }

      // TODO: track consumption
      // TODO: restrict value size
      // TODO: don't let timer abort db operation
      uint64_t kv_put_sequential(uint32_t map, span<const char> value)
      {
         auto m = get_map_write_sequential(map);

         eosio::input_stream v{value.data(), value.size()};
         eosio::check(v.remaining() >= sizeof(AccountNumber::value),
                      "value prefix must match contract during write");
         auto contract = eosio::from_bin<AccountNumber>(v);
         eosio::check(contract == contract_account.num,
                      "value prefix must match contract during write");

         auto&    dbStatus = trx_context.block_context.databaseStatus;
         uint64_t indexNumber;
         if (map == uint32_t(kv_map::event))
            indexNumber = dbStatus.nextEventNumber++;
         else if (map == uint32_t(kv_map::ui_event))
            indexNumber = dbStatus.nextUIEventNumber++;
         else
            eosio::check(false, "kv_put_sequential: unsupported map");
         db.kv_put(DatabaseStatusRow::kv_map, dbStatus.key(), dbStatus);

         db.kv_put_raw(m, eosio::convert_to_key(indexNumber), {value.data(), value.size()});
         return indexNumber;
      }  // kv_put_sequential()

      // TODO: track consumption
      // TODO: don't let timer abort db operation
      void kv_remove(uint32_t map, span<const char> key)
      {
         clear_result();
         db.kv_remove_raw(get_map_write(map, {key.data(), key.size()}), {key.data(), key.size()});
      }

      // TODO: don't let timer abort db operation
      uint32_t kv_get(uint32_t map, span<const char> key)
      {
         return set_result(db.kv_get_raw(get_map_read(map), {key.data(), key.size()}));
      }

      // TODO: don't let timer abort db operation
      uint32_t kv_get_sequential(uint32_t map, uint64_t indexNumber)
      {
         auto m = get_map_read_sequential(map);
         return set_result(db.kv_get_raw(m, eosio::convert_to_key(indexNumber)));
      }

      // TODO: don't let timer abort db operation
      uint32_t kv_greater_equal(uint32_t map, span<const char> key, uint32_t match_key_size)
      {
         eosio::check(match_key_size <= key.size(), "match_key_size is larger than key");
         if (key_has_contract_prefix(map))
            eosio::check(match_key_size >= sizeof(AccountNumber::value),
                         "match_key_size is smaller than 8 bytes");
         return set_result(
             db.kv_greater_equal_raw(get_map_read(map), {key.data(), key.size()}, match_key_size));
      }

      // TODO: don't let timer abort db operation
      uint32_t kv_less_than(uint32_t map, span<const char> key, uint32_t match_key_size)
      {
         eosio::check(match_key_size <= key.size(), "match_key_size is larger than key");
         if (key_has_contract_prefix(map))
            eosio::check(match_key_size >= sizeof(AccountNumber::value),
                         "match_key_size is smaller than 8 bytes");
         return set_result(
             db.kv_less_than_raw(get_map_read(map), {key.data(), key.size()}, match_key_size));
      }

      // TODO: don't let timer abort db operation
      uint32_t kv_max(uint32_t map, span<const char> key)
      {
         if (key_has_contract_prefix(map))
            eosio::check(key.size() >= sizeof(AccountNumber::value), "key is shorter than 8 bytes");
         return set_result(db.kv_max_raw(get_map_read(map), {key.data(), key.size()}));
      }
   };  // execution_context_impl

   execution_context::execution_context(transaction_context& trx_context,
                                        execution_memory&    memory,
                                        account_num          contract)
   {
      impl = std::make_unique<execution_context_impl>(trx_context, memory, contract);
   }

   execution_context::execution_context(execution_context&& src)
   {
      impl = std::move(src.impl);
   }
   execution_context::~execution_context() {}

   void execution_context::register_host_functions()
   {
      rhf_t::add<&execution_context_impl::get_result>("env", "get_result");
      rhf_t::add<&execution_context_impl::get_key>("env", "get_key");
      rhf_t::add<&execution_context_impl::write_console>("env", "write_console");
      rhf_t::add<&execution_context_impl::abort_message>("env", "abort_message");
      rhf_t::add<&execution_context_impl::get_current_action>("env", "get_current_action");
      rhf_t::add<&execution_context_impl::call>("env", "call");
      rhf_t::add<&execution_context_impl::set_retval>("env", "set_retval");
      rhf_t::add<&execution_context_impl::kv_put>("env", "kv_put");
      rhf_t::add<&execution_context_impl::kv_put_sequential>("env", "kv_put_sequential");
      rhf_t::add<&execution_context_impl::kv_remove>("env", "kv_remove");
      rhf_t::add<&execution_context_impl::kv_get>("env", "kv_get");
      rhf_t::add<&execution_context_impl::kv_get_sequential>("env", "kv_get_sequential");
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
         (*impl->backend)(*impl, "env", "called", act_context.action.contract.value,
                          act_context.action.sender.value);
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
         (*impl->backend)(*impl, "env", "serve");
      });
   }
}  // namespace psibase
