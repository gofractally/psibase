#include <psibase/ExecutionContext.hpp>

#include <atomic>
#include <boost/multi_index/key.hpp>
#include <boost/multi_index/ordered_index.hpp>
#include <boost/multi_index/sequenced_index.hpp>
#include <boost/multi_index_container.hpp>
#include <eosio/vm/backend.hpp>
#include <mutex>
#include <psibase/ActionContext.hpp>
#include <psibase/db.hpp>
#include <psio/from_bin.hpp>

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
   void set_code(database&          db,
                 AccountNumber      contract,
                 uint8_t            vmType,
                 uint8_t            vmVersion,
                 psio::input_stream code)
   {
      check(code.remaining(), "native set_code can't clear code");
      auto code_hash = sha256(code.pos, code.remaining());

      auto account = db.kvGet<account_row>(account_row::kv_map, account_key(contract));
      check(account.has_value(), "set_code: unknown contract account");
      check(account->code_hash == Checksum256{}, "native set_code can't replace code");
      account->code_hash = code_hash;
      account->vmType    = vmType;
      account->vmVersion = vmVersion;
      db.kvPut(account_row::kv_map, account->key(), *account);

      auto code_obj = db.kvGet<code_row>(code_row::kv_map, code_key(code_hash, vmType, vmVersion));
      if (!code_obj)
      {
         code_obj.emplace();
         code_obj->code_hash = code_hash;
         code_obj->vmType    = vmType;
         code_obj->vmVersion = vmVersion;
         code_obj->code.assign(code.pos, code.end);
      }
      ++code_obj->ref_count;
      db.kvPut(code_row::kv_map, code_obj->key(), *code_obj);
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
         result->get_module().allocator.enable_code(true);
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
      std::atomic<bool>          timed_out = false;
      account_row                contract_account;
      bool                       initialized         = false;
      action_context*            current_act_context = nullptr;  // Changes during recursion

      execution_context_impl(transaction_context& trx_context,
                             execution_memory&    memory,
                             AccountNumber        contract)
          : db{trx_context.block_context.db}, trx_context{trx_context}, wa{memory.impl->wa}
      {
         auto load_start = std::chrono::steady_clock::now();
         auto ca         = db.kvGet<account_row>(account_row::kv_map, account_key(contract));
         check(ca.has_value(), "unknown contract account");
         check(ca->code_hash != Checksum256{}, "account has no code");
         contract_account = std::move(*ca);
         auto code        = db.kvGet<code_row>(
             code_row::kv_map, code_key(contract_account.code_hash, contract_account.vmType,
                                               contract_account.vmVersion));
         check(code.has_value(), "code record is missing");
         check(code->vmType == 0, "vmType is not 0");
         check(code->vmVersion == 0, "vmVersion is not 0");
         rethrow_vm_except(
             [&]
             {
                backend = trx_context.block_context.system_context.wasm_cache.impl->get(
                    contract_account.code_hash);
                if (!backend)
                   backend = std::make_unique<backend_t>(code->code, nullptr);
             });
         trx_context.contract_load_time += std::chrono::steady_clock::now() - load_start;
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
         try
         {
            if (!initialized)
               init();
            rethrow_vm_except(f);
         }
         catch (...)
         {
            if (timed_out)
               throw timeout_exception{};
            throw;
         }
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

      struct Writable
      {
         kv_map map;
         bool   readable;
      };

      Writable get_map_write(uint32_t map, psio::input_stream key)
      {
         check(!trx_context.block_context.is_read_only, "writes disabled during query");

         auto check_prefix = [&]
         {
            uint64_t prefix = contract_account.num.value;
            std::reverse(reinterpret_cast<char*>(&prefix), reinterpret_cast<char*>(&prefix + 1));
            check(key.remaining() >= sizeof(prefix) && !memcmp(key.pos, &prefix, sizeof(prefix)),
                  "key prefix must match contract during write");
         };

         if (map == uint32_t(kv_map::subjective) &&
             (contract_account.flags & account_row::is_subjective))
         {
            check_prefix();
            return {(kv_map)map, true};
         }

         // Prevent poison block; subjective contracts skip execution during replay
         check(!(contract_account.flags & account_row::is_subjective),
               "subjective contracts may only write to kv_map::subjective");

         if (map == uint32_t(kv_map::contract) || map == uint32_t(kv_map::write_only))
         {
            check_prefix();
            return {(kv_map)map, false};
         }
         if (map == uint32_t(kv_map::native_constrained) &&
             (contract_account.flags & account_row::allow_write_native))
            return {(kv_map)map, true};
         if (map == uint32_t(kv_map::native_unconstrained) &&
             (contract_account.flags & account_row::allow_write_native))
            return {(kv_map)map, true};
         throw std::runtime_error("contract may not write this map, or must use another intrinsic");
      }

      kv_map get_map_write_sequential(uint32_t map)
      {
         check(!trx_context.block_context.is_read_only, "writes disabled during query");

         // Prevent poison block; subjective contracts skip execution during replay
         check(!(contract_account.flags & account_row::is_subjective),
               "contract may not write this map, or must use another intrinsic");

         if (map == uint32_t(kv_map::event))
            return (kv_map)map;
         if (map == uint32_t(kv_map::ui_event))
            return (kv_map)map;
         throw std::runtime_error("contract may not write this map, or must use another intrinsic");
      }

      void verify_write_constrained(psio::input_stream key, psio::input_stream value)
      {
         // Currently, code is the only table which lives in native_constrained
         // which is writable by contracts. The other tables aren't writable by
         // contracts.
         //
         // TODO: use a view here instead of unpacking to a rich object
         // TODO: verify fracpack; no unknown
         auto code = psio::convert_from_frac<code_row>(psio::input_stream(value.pos, value.end));
         auto code_hash = sha256(code.code.data(), code.code.size());
         check(code.code_hash == code_hash, "code_row has incorrect code_hash");
         auto expected_key = psio::convert_to_key(code.key());
         check(key.remaining() == expected_key.size() &&
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

      uint32_t set_result(const std::optional<psio::input_stream>& o)
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

      uint32_t getResult(span<char> dest, uint32_t offset)
      {
         if (offset < result_value.size() && dest.size())
            memcpy(dest.data(), result_value.data() + offset,
                   std::min(result_value.size() - offset, dest.size()));
         return result_value.size();
      }

      uint32_t getKey(span<char> dest)
      {
         if (!result_key.empty())
            memcpy(dest.data(), result_key.data(), std::min(result_key.size(), dest.size()));
         return result_key.size();
      }

      void writeConsole(span<const char> str)
      {
         // TODO: limit total console size across all executions within transaction
         if (current_act_context->action_trace.innerTraces.empty() ||
             !std::holds_alternative<ConsoleTrace>(
                 current_act_context->action_trace.innerTraces.back().inner))
            current_act_context->action_trace.innerTraces.push_back({ConsoleTrace{}});
         auto& console =
             std::get<ConsoleTrace>(current_act_context->action_trace.innerTraces.back().inner)
                 .console;
         console.append(str.begin(), str.end());
         clear_result();
      }

      void abortMessage(span<const char> str)
      {
         throw std::runtime_error("contract '" + contract_account.num.str() +
                                  "' aborted with message: " + std::string(str.data(), str.size()));
      }

      uint64_t getBillableTime()
      {
         // A more-accurate message is "only subjective contracts may
         // call getBillableTime", but that may mislead contract developers
         // into thinking they should create a subjective contract;
         // they shouldn't.
         check(contract_account.flags & account_row::is_subjective,
               "unprivileged contracts may not call getBillableTime");
         return std::chrono::duration_cast<std::chrono::nanoseconds>(
                    std::chrono::steady_clock::now() - trx_context.start_time -
                    trx_context.contract_load_time)
             .count();
      }

      uint32_t getCurrentAction()
      {
         return set_result(psio::convert_to_frac(current_act_context->action));
      }

      uint32_t call(span<const char> data)
      {
         // TODO: replace temporary rule
         if (++current_act_context->transaction_context.call_depth > 6)
            check(false, "call depth exceeded (temporary rule)");

         // TODO: don't unpack rawData
         check(psio::fracvalidate<Action>(data.data(), data.end()).valid_and_known(),
               "call: invalid data format");
         auto act = psio::convert_from_frac<Action>({data.data(), data.size()});
         check(act.sender == contract_account.num ||
                   (contract_account.flags & account_row::allow_sudo),
               "contract is not authorized to call as another sender");

         current_act_context->action_trace.innerTraces.push_back({ActionTrace{}});
         auto& inner_action_trace =
             std::get<ActionTrace>(current_act_context->action_trace.innerTraces.back().inner);
         // TODO: avoid reserialization
         current_act_context->transaction_context.exec_called_action(contract_account.flags, act,
                                                                     inner_action_trace);
         set_result(inner_action_trace.rawRetval);

         --current_act_context->transaction_context.call_depth;
         return result_value.size();
      }

      void setRetval(span<const char> data)
      {
         current_act_context->action_trace.rawRetval.assign(data.begin(), data.end());
         clear_result();
      }

      // TODO: restrict key size
      // TODO: restrict value size
      void kvPut(uint32_t map, span<const char> key, span<const char> value)
      {
         if (map == uint32_t(kv_map::native_constrained))
            verify_write_constrained({key.data(), key.size()}, {value.data(), value.size()});
         clear_result();
         auto [m, readable] = get_map_write(map, {key.data(), key.size()});
         auto& delta = trx_context.kvResourceDeltas[KvResourceKey{contract_account.num, map}];
         delta.records += 1;
         delta.keyBytes += key.size();
         delta.valueBytes += value.size();
         if (readable)
         {
            if (auto existing = db.kvGetRaw(m, {key.data(), key.size()}))
            {
               delta.records -= 1;
               delta.keyBytes -= key.size();
               delta.valueBytes -= existing->remaining();
            }
         }
         db.kvPutRaw(m, {key.data(), key.size()}, {value.data(), value.size()});
      }

      // TODO: restrict value size
      uint64_t kvPutSequential(uint32_t map, span<const char> value)
      {
         auto  m     = get_map_write_sequential(map);
         auto& delta = trx_context.kvResourceDeltas[KvResourceKey{contract_account.num, map}];
         delta.records += 1;
         delta.keyBytes += sizeof(uint64_t);
         delta.valueBytes += value.size();

         psio::input_stream v{value.data(), value.size()};
         check(v.remaining() >= sizeof(AccountNumber::value),
               "value prefix must match contract during write");
         auto contract = psio::from_bin<AccountNumber>(v);
         check(contract == contract_account.num, "value prefix must match contract during write");

         auto&    dbStatus = trx_context.block_context.databaseStatus;
         uint64_t indexNumber;
         if (map == uint32_t(kv_map::event))
            indexNumber = dbStatus.nextEventNumber++;
         else if (map == uint32_t(kv_map::ui_event))
            indexNumber = dbStatus.nextUIEventNumber++;
         else
            check(false, "kvPutSequential: unsupported map");
         db.kvPut(DatabaseStatusRow::kv_map, dbStatus.key(), dbStatus);

         db.kvPutRaw(m, psio::convert_to_key(indexNumber), {value.data(), value.size()});
         return indexNumber;
      }  // kvPutSequential()

      void kvRemove(uint32_t map, span<const char> key)
      {
         clear_result();
         auto [m, readable] = get_map_write(map, {key.data(), key.size()});
         if (readable)
         {
            if (auto existing = db.kvGetRaw(m, {key.data(), key.size()}))
            {
               auto& delta = trx_context.kvResourceDeltas[KvResourceKey{contract_account.num, map}];
               delta.records -= 1;
               delta.keyBytes -= key.size();
               delta.valueBytes -= existing->remaining();
            }
         }
         db.kvRemoveRaw(m, {key.data(), key.size()});
      }

      uint32_t kvGet(uint32_t map, span<const char> key)
      {
         return set_result(db.kvGetRaw(get_map_read(map), {key.data(), key.size()}));
      }

      uint32_t kvGetSequential(uint32_t map, uint64_t indexNumber)
      {
         auto m = get_map_read_sequential(map);
         return set_result(db.kvGetRaw(m, psio::convert_to_key(indexNumber)));
      }

      uint32_t kvGreaterEqual(uint32_t map, span<const char> key, uint32_t match_key_size)
      {
         check(match_key_size <= key.size(), "match_key_size is larger than key");
         if (key_has_contract_prefix(map))
            check(match_key_size >= sizeof(AccountNumber::value),
                  "match_key_size is smaller than 8 bytes");
         return set_result(
             db.kvGreaterEqualRaw(get_map_read(map), {key.data(), key.size()}, match_key_size));
      }

      uint32_t kvLessThan(uint32_t map, span<const char> key, uint32_t match_key_size)
      {
         check(match_key_size <= key.size(), "match_key_size is larger than key");
         if (key_has_contract_prefix(map))
            check(match_key_size >= sizeof(AccountNumber::value),
                  "match_key_size is smaller than 8 bytes");
         return set_result(
             db.kvLessThanRaw(get_map_read(map), {key.data(), key.size()}, match_key_size));
      }

      uint32_t kvMax(uint32_t map, span<const char> key)
      {
         if (key_has_contract_prefix(map))
            check(key.size() >= sizeof(AccountNumber::value), "key is shorter than 8 bytes");
         return set_result(db.kvMaxRaw(get_map_read(map), {key.data(), key.size()}));
      }

      uint32_t kvGetTransactionUsage()
      {
         auto seq  = trx_context.kvResourceDeltas.extract_sequence();
         auto size = set_result(psio::convert_to_frac(seq));
         trx_context.kvResourceDeltas.adopt_sequence(boost::container::ordered_unique_range,
                                                     std::move(seq));
         return size;
      }
   };  // execution_context_impl

   execution_context::execution_context(transaction_context& trx_context,
                                        execution_memory&    memory,
                                        AccountNumber        contract)
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
      rhf_t::add<&execution_context_impl::getResult>("env", "getResult");
      rhf_t::add<&execution_context_impl::getKey>("env", "getKey");
      rhf_t::add<&execution_context_impl::writeConsole>("env", "writeConsole");
      rhf_t::add<&execution_context_impl::abortMessage>("env", "abortMessage");
      rhf_t::add<&execution_context_impl::getBillableTime>("env", "getBillableTime");
      rhf_t::add<&execution_context_impl::getCurrentAction>("env", "getCurrentAction");
      rhf_t::add<&execution_context_impl::call>("env", "call");
      rhf_t::add<&execution_context_impl::setRetval>("env", "setRetval");
      rhf_t::add<&execution_context_impl::kvPut>("env", "kvPut");
      rhf_t::add<&execution_context_impl::kvPutSequential>("env", "kvPutSequential");
      rhf_t::add<&execution_context_impl::kvRemove>("env", "kvRemove");
      rhf_t::add<&execution_context_impl::kvGet>("env", "kvGet");
      rhf_t::add<&execution_context_impl::kvGetSequential>("env", "kvGetSequential");
      rhf_t::add<&execution_context_impl::kvGreaterEqual>("env", "kvGreaterEqual");
      rhf_t::add<&execution_context_impl::kvLessThan>("env", "kvLessThan");
      rhf_t::add<&execution_context_impl::kvMax>("env", "kvMax");
      rhf_t::add<&execution_context_impl::kvGetTransactionUsage>("env", "kvGetTransactionUsage");
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
         check(!(caller_flags & account_row::is_subjective),
               "subjective contracts may not call non-subjective ones");

      auto& bc = impl->trx_context.block_context;
      if ((impl->contract_account.flags & account_row::is_subjective) && !bc.is_producing)
      {
         check(bc.nextSubjectiveRead < bc.current.subjectiveData.size(), "missing subjective data");
         impl->current_act_context->action_trace.rawRetval =
             bc.current.subjectiveData[bc.nextSubjectiveRead++];
         return;
      }

      impl->exec(act_context, [&] {  //
         (*impl->backend)(*impl, "env", "called", act_context.action.contract.value,
                          act_context.action.sender.value);
      });

      if ((impl->contract_account.flags & account_row::is_subjective) &&
          !(caller_flags & account_row::is_subjective))
         bc.current.subjectiveData.push_back(impl->current_act_context->action_trace.rawRetval);
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

   void execution_context::async_timeout()
   {
      if (impl->contract_account.flags & account_row::can_not_time_out)
         return;
      impl->timed_out = true;
      impl->backend->get_module().allocator.disable_code();
   }
}  // namespace psibase
