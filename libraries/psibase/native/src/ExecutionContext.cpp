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
   struct ExecutionContextImpl;
   using rhf_t     = eosio::vm::registered_host_functions<ExecutionContextImpl>;
   using backend_t = eosio::vm::backend<rhf_t, eosio::vm::jit>;

   // Rethrow with detailed info
   template <typename F>
   void rethrowVMExcept(F f)
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
   void setCode(Database&          db,
                AccountNumber      contract,
                uint8_t            vmType,
                uint8_t            vmVersion,
                psio::input_stream code)
   {
      check(code.remaining(), "native setCode can't clear code");
      auto code_hash = sha256(code.pos, code.remaining());

      auto account = db.kvGet<account_row>(account_row::kv_map, account_key(contract));
      check(account.has_value(), "setCode: unknown contract account");
      check(account->code_hash == Checksum256{}, "native setCode can't replace code");
      account->code_hash = code_hash;
      account->vmType    = vmType;
      account->vmVersion = vmVersion;
      db.kvPut(account_row::kv_map, account->key(), *account);

      auto codeObj = db.kvGet<code_row>(code_row::kv_map, code_key(code_hash, vmType, vmVersion));
      if (!codeObj)
      {
         codeObj.emplace();
         codeObj->code_hash = code_hash;
         codeObj->vmType    = vmType;
         codeObj->vmVersion = vmVersion;
         codeObj->code.assign(code.pos, code.end);
      }
      ++codeObj->ref_count;
      db.kvPut(code_row::kv_map, codeObj->key(), *codeObj);
   }  // setCode

   struct BackendEntry
   {
      Checksum256                hash;
      std::unique_ptr<backend_t> backend;
   };

   struct ByAge;
   struct ByHash;

   using BackendContainer = bmi::multi_index_container<
       BackendEntry,
       bmi::indexed_by<bmi::sequenced<bmi::tag<ByAge>>,
                       bmi::ordered_non_unique<bmi::tag<ByHash>, bmi::key<&BackendEntry::hash>>>>;

   struct WasmCacheImpl
   {
      std::mutex       mutex;
      uint32_t         cacheSize;
      BackendContainer backends;

      WasmCacheImpl(uint32_t cacheSize) : cacheSize{cacheSize} {}

      void add(BackendEntry&& entry)
      {
         std::lock_guard<std::mutex> lock{mutex};
         auto&                       ind = backends.get<ByAge>();
         ind.push_back(std::move(entry));
         while (ind.size() > cacheSize)
            ind.pop_front();
      }

      std::unique_ptr<backend_t> get(const Checksum256& hash)
      {
         std::unique_ptr<backend_t>  result;
         std::lock_guard<std::mutex> lock{mutex};
         auto&                       ind = backends.get<ByHash>();
         auto                        it  = ind.find(hash);
         if (it == ind.end())
            return result;
         ind.modify(it, [&](auto& x) { result = std::move(x.backend); });
         ind.erase(it);
         result->get_module().allocator.enable_code(true);
         return result;
      }
   };

   WasmCache::WasmCache(uint32_t cacheSize) : impl{std::make_shared<WasmCacheImpl>(cacheSize)} {}

   WasmCache::WasmCache(const WasmCache& src) : impl{src.impl} {}

   WasmCache::WasmCache(WasmCache&& src) : impl{std::move(src.impl)} {}

   WasmCache::~WasmCache() {}

   struct ExecutionMemoryImpl
   {
      eosio::vm::wasm_allocator wa;
   };

   std::unique_ptr<ExecutionMemoryImpl> impl;

   ExecutionMemory::ExecutionMemory()
   {
      impl = std::make_unique<ExecutionMemoryImpl>();
   }
   ExecutionMemory::ExecutionMemory(ExecutionMemory&& src)
   {
      impl = std::move(src.impl);
   }
   ExecutionMemory::~ExecutionMemory() {}

   // TODO: debugger
   struct ExecutionContextImpl
   {
      Database&                  db;
      TransactionContext&        transactionContext;
      eosio::vm::wasm_allocator& wa;
      std::unique_ptr<backend_t> backend;
      std::atomic<bool>          timedOut = false;
      account_row                contractAccount;
      bool                       initialized       = false;
      ActionContext*             currentActContext = nullptr;  // Changes during recursion

      ExecutionContextImpl(TransactionContext& transactionContext,
                           ExecutionMemory&    memory,
                           AccountNumber       contract)
          : db{transactionContext.blockContext.db},
            transactionContext{transactionContext},
            wa{memory.impl->wa}
      {
         auto ca = db.kvGet<account_row>(account_row::kv_map, account_key(contract));
         check(ca.has_value(), "unknown contract account");
         check(ca->code_hash != Checksum256{}, "account has no code");
         contractAccount = std::move(*ca);
         auto code       = db.kvGet<code_row>(code_row::kv_map,
                                        code_key(contractAccount.code_hash, contractAccount.vmType,
                                                       contractAccount.vmVersion));
         check(code.has_value(), "code record is missing");
         check(code->vmType == 0, "vmType is not 0");
         check(code->vmVersion == 0, "vmVersion is not 0");
         rethrowVMExcept(
             [&]
             {
                backend = transactionContext.blockContext.systemContext.wasmCache.impl->get(
                    contractAccount.code_hash);
                if (!backend)
                   backend = std::make_unique<backend_t>(code->code, nullptr);
             });
      }

      ~ExecutionContextImpl()
      {
         transactionContext.blockContext.systemContext.wasmCache.impl->add(
             {contractAccount.code_hash, std::move(backend)});
      }

      // TODO: configurable wasm limits
      void init()
      {
         rethrowVMExcept(
             [&]
             {
                // auto startTime = std::chrono::steady_clock::now();
                backend->set_wasm_allocator(&wa);
                backend->initialize(this);
                (*backend)(*this, "env", "start", currentActContext->action.contract.value);
                initialized = true;
                // auto us     = std::chrono::duration_cast<std::chrono::microseconds>(
                //     std::chrono::steady_clock::now() - startTime);
                // std::cout << "init:   " << us.count() << " us\n";
             });
      }

      template <typename F>
      void exec(ActionContext& actionContext, F f)
      {
         auto prev         = currentActContext;
         currentActContext = &actionContext;
         try
         {
            if (!initialized)
               init();
            rethrowVMExcept(f);
         }
         catch (...)
         {
            if (timedOut)
               throw TimeoutException{};
            throw;
         }
         currentActContext = prev;
      }

      kv_map getMapRead(uint32_t map)
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
            if ((contractAccount.flags & account_row::is_subjective) ||
                transactionContext.blockContext.isReadOnly)
               return (kv_map)map;
         }
         if (map == uint32_t(kv_map::write_only) && transactionContext.blockContext.isReadOnly)
            return (kv_map)map;
         if (map == uint32_t(kv_map::block_log) && transactionContext.blockContext.isReadOnly)
            return (kv_map)map;
         throw std::runtime_error("contract may not read this map, or must use another intrinsic");
      }

      kv_map getMapReadSequential(uint32_t map)
      {
         if (map == uint32_t(kv_map::event) && transactionContext.blockContext.isReadOnly)
            return (kv_map)map;
         if (map == uint32_t(kv_map::ui_event) && transactionContext.blockContext.isReadOnly)
            return (kv_map)map;
         throw std::runtime_error("contract may not read this map, or must use another intrinsic");
      }

      bool keyHasContractPrefix(uint32_t map)
      {
         return map == uint32_t(kv_map::contract) || map == uint32_t(kv_map::write_only) ||
                map == uint32_t(kv_map::subjective);
      }

      struct Writable
      {
         kv_map map;
         bool   readable;
      };

      Writable getMapWrite(uint32_t map, psio::input_stream key)
      {
         check(!transactionContext.blockContext.isReadOnly, "writes disabled during query");

         if (keyHasContractPrefix(map))
         {
            uint64_t prefix = contractAccount.num.value;
            std::reverse(reinterpret_cast<char*>(&prefix), reinterpret_cast<char*>(&prefix + 1));
            check(key.remaining() >= sizeof(prefix) && !memcmp(key.pos, &prefix, sizeof(prefix)),
                  "key prefix must match contract during write");
         };

         if (map == uint32_t(kv_map::subjective) &&
             (contractAccount.flags & account_row::is_subjective))
            return {(kv_map)map, true};

         // Prevent poison block; subjective contracts skip execution during replay
         check(!(contractAccount.flags & account_row::is_subjective),
               "subjective contracts may only write to kv_map::subjective");

         if (map == uint32_t(kv_map::contract) || map == uint32_t(kv_map::write_only))
            return {(kv_map)map, false};
         if (map == uint32_t(kv_map::native_constrained) &&
             (contractAccount.flags & account_row::allow_write_native))
            return {(kv_map)map, true};
         if (map == uint32_t(kv_map::native_unconstrained) &&
             (contractAccount.flags & account_row::allow_write_native))
            return {(kv_map)map, true};
         throw std::runtime_error("contract may not write this map (" + std::to_string(map) +
                                  "), or must use another intrinsic");
      }

      kv_map getMapWriteSequential(uint32_t map)
      {
         check(!transactionContext.blockContext.isReadOnly, "writes disabled during query");

         // Prevent poison block; subjective contracts skip execution during replay
         check(!(contractAccount.flags & account_row::is_subjective),
               "contract may not write this map, or must use another intrinsic");

         if (map == uint32_t(kv_map::event))
            return (kv_map)map;
         if (map == uint32_t(kv_map::ui_event))
            return (kv_map)map;
         throw std::runtime_error("contract may not write this map (" + std::to_string(map) +
                                  "), or must use another intrinsic");
      }

      void verifyWriteConstrained(psio::input_stream key, psio::input_stream value)
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

      uint32_t clearResult()
      {
         result_key.clear();
         result_value.clear();
         return -1;
      }

      uint32_t setResult(std::vector<char> result)
      {
         result_key.clear();
         result_value = std::move(result);
         return result_value.size();
      }

      uint32_t setResult(const std::optional<psio::input_stream>& o)
      {
         if (!o)
            return clearResult();
         result_key.clear();
         result_value.assign(o->pos, o->end);
         return result_value.size();
      }

      uint32_t setResult(const std::optional<Database::KVResult>& o)
      {
         if (!o)
            return clearResult();
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
         if (currentActContext->actionTrace.innerTraces.empty() ||
             !std::holds_alternative<ConsoleTrace>(
                 currentActContext->actionTrace.innerTraces.back().inner))
            currentActContext->actionTrace.innerTraces.push_back({ConsoleTrace{}});
         auto& console =
             std::get<ConsoleTrace>(currentActContext->actionTrace.innerTraces.back().inner)
                 .console;
         console.append(str.begin(), str.end());
         clearResult();
      }

      void abortMessage(span<const char> str)
      {
         throw std::runtime_error("contract '" + contractAccount.num.str() +
                                  "' aborted with message: " + std::string(str.data(), str.size()));
      }

      uint64_t getBillableTime()
      {
         // A more-accurate message is "only subjective contracts may
         // call getBillableTime", but that may mislead contract developers
         // into thinking they should create a subjective contract;
         // they shouldn't.
         check(contractAccount.flags & account_row::is_subjective,
               "unprivileged contracts may not call getBillableTime");
         return std::chrono::duration_cast<std::chrono::nanoseconds>(
                    std::chrono::steady_clock::now() - transactionContext.startTime -
                    transactionContext.getContractLoadTime())
             .count();
      }

      uint32_t getCurrentAction()
      {
         return setResult(psio::convert_to_frac(currentActContext->action));
      }

      uint32_t call(span<const char> data)
      {
         // TODO: replace temporary rule
         if (++currentActContext->transactionContext.callDepth > 6)
            check(false, "call depth exceeded (temporary rule)");

         // TODO: don't unpack rawData
         check(psio::fracvalidate<Action>(data.data(), data.end()).valid_and_known(),
               "call: invalid data format");
         auto act = psio::convert_from_frac<Action>({data.data(), data.size()});
         check(
             act.sender == contractAccount.num || (contractAccount.flags & account_row::allow_sudo),
             "contract is not authorized to call as another sender");

         currentActContext->actionTrace.innerTraces.push_back({ActionTrace{}});
         auto& inner_action_trace =
             std::get<ActionTrace>(currentActContext->actionTrace.innerTraces.back().inner);
         // TODO: avoid reserialization
         currentActContext->transactionContext.execCalledAction(contractAccount.flags, act,
                                                                inner_action_trace);
         setResult(inner_action_trace.rawRetval);

         --currentActContext->transactionContext.callDepth;
         return result_value.size();
      }

      void setRetval(span<const char> data)
      {
         currentActContext->actionTrace.rawRetval.assign(data.begin(), data.end());
         clearResult();
      }

      // TODO: restrict key size
      // TODO: restrict value size
      void kvPut(uint32_t map, span<const char> key, span<const char> value)
      {
         if (map == uint32_t(kv_map::native_constrained))
            verifyWriteConstrained({key.data(), key.size()}, {value.data(), value.size()});
         clearResult();
         auto [m, readable] = getMapWrite(map, {key.data(), key.size()});
         auto& delta = transactionContext.kvResourceDeltas[KvResourceKey{contractAccount.num, map}];
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
         auto  m     = getMapWriteSequential(map);
         auto& delta = transactionContext.kvResourceDeltas[KvResourceKey{contractAccount.num, map}];
         delta.records += 1;
         delta.keyBytes += sizeof(uint64_t);
         delta.valueBytes += value.size();

         psio::input_stream v{value.data(), value.size()};
         check(v.remaining() >= sizeof(AccountNumber::value),
               "value prefix must match contract during write");
         auto contract = psio::from_bin<AccountNumber>(v);
         check(contract == contractAccount.num, "value prefix must match contract during write");

         auto&    dbStatus = transactionContext.blockContext.databaseStatus;
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
         clearResult();
         auto [m, readable] = getMapWrite(map, {key.data(), key.size()});
         if (readable)
         {
            if (auto existing = db.kvGetRaw(m, {key.data(), key.size()}))
            {
               auto& delta =
                   transactionContext.kvResourceDeltas[KvResourceKey{contractAccount.num, map}];
               delta.records -= 1;
               delta.keyBytes -= key.size();
               delta.valueBytes -= existing->remaining();
            }
         }
         db.kvRemoveRaw(m, {key.data(), key.size()});
      }

      uint32_t kvGet(uint32_t map, span<const char> key)
      {
         return setResult(db.kvGetRaw(getMapRead(map), {key.data(), key.size()}));
      }

      uint32_t kvGetSequential(uint32_t map, uint64_t indexNumber)
      {
         auto m = getMapReadSequential(map);
         return setResult(db.kvGetRaw(m, psio::convert_to_key(indexNumber)));
      }

      uint32_t kvGreaterEqual(uint32_t map, span<const char> key, uint32_t matchKeySize)
      {
         check(matchKeySize <= key.size(), "matchKeySize is larger than key");
         if (keyHasContractPrefix(map))
            check(matchKeySize >= sizeof(AccountNumber::value),
                  "matchKeySize is smaller than 8 bytes");
         return setResult(
             db.kvGreaterEqualRaw(getMapRead(map), {key.data(), key.size()}, matchKeySize));
      }

      uint32_t kvLessThan(uint32_t map, span<const char> key, uint32_t matchKeySize)
      {
         check(matchKeySize <= key.size(), "matchKeySize is larger than key");
         if (keyHasContractPrefix(map))
            check(matchKeySize >= sizeof(AccountNumber::value),
                  "matchKeySize is smaller than 8 bytes");
         return setResult(
             db.kvLessThanRaw(getMapRead(map), {key.data(), key.size()}, matchKeySize));
      }

      uint32_t kvMax(uint32_t map, span<const char> key)
      {
         if (keyHasContractPrefix(map))
            check(key.size() >= sizeof(AccountNumber::value), "key is shorter than 8 bytes");
         return setResult(db.kvMaxRaw(getMapRead(map), {key.data(), key.size()}));
      }

      uint32_t kvGetTransactionUsage()
      {
         auto seq  = transactionContext.kvResourceDeltas.extract_sequence();
         auto size = setResult(psio::convert_to_frac(seq));
         transactionContext.kvResourceDeltas.adopt_sequence(boost::container::ordered_unique_range,
                                                            std::move(seq));
         return size;
      }
   };  // ExecutionContextImpl

   ExecutionContext::ExecutionContext(TransactionContext& transactionContext,
                                      ExecutionMemory&    memory,
                                      AccountNumber       contract)
   {
      impl = std::make_unique<ExecutionContextImpl>(transactionContext, memory, contract);
   }

   ExecutionContext::ExecutionContext(ExecutionContext&& src)
   {
      impl = std::move(src.impl);
   }
   ExecutionContext::~ExecutionContext() {}

   void ExecutionContext::registerHostFunctions()
   {
      rhf_t::add<&ExecutionContextImpl::getResult>("env", "getResult");
      rhf_t::add<&ExecutionContextImpl::getKey>("env", "getKey");
      rhf_t::add<&ExecutionContextImpl::writeConsole>("env", "writeConsole");
      rhf_t::add<&ExecutionContextImpl::abortMessage>("env", "abortMessage");
      rhf_t::add<&ExecutionContextImpl::getBillableTime>("env", "getBillableTime");
      rhf_t::add<&ExecutionContextImpl::getCurrentAction>("env", "getCurrentAction");
      rhf_t::add<&ExecutionContextImpl::call>("env", "call");
      rhf_t::add<&ExecutionContextImpl::setRetval>("env", "setRetval");
      rhf_t::add<&ExecutionContextImpl::kvPut>("env", "kvPut");
      rhf_t::add<&ExecutionContextImpl::kvPutSequential>("env", "kvPutSequential");
      rhf_t::add<&ExecutionContextImpl::kvRemove>("env", "kvRemove");
      rhf_t::add<&ExecutionContextImpl::kvGet>("env", "kvGet");
      rhf_t::add<&ExecutionContextImpl::kvGetSequential>("env", "kvGetSequential");
      rhf_t::add<&ExecutionContextImpl::kvGreaterEqual>("env", "kvGreaterEqual");
      rhf_t::add<&ExecutionContextImpl::kvLessThan>("env", "kvLessThan");
      rhf_t::add<&ExecutionContextImpl::kvMax>("env", "kvMax");
      rhf_t::add<&ExecutionContextImpl::kvGetTransactionUsage>("env", "kvGetTransactionUsage");
   }

   void ExecutionContext::execProcessTransaction(ActionContext& actionContext)
   {
      impl->exec(actionContext, [&] {  //
         (*impl->backend)(*impl, "env", "process_transaction");
      });
   }

   void ExecutionContext::execCalled(uint64_t callerFlags, ActionContext& actionContext)
   {
      // Prevents a poison block
      if (!(impl->contractAccount.flags & account_row::is_subjective))
         check(!(callerFlags & account_row::is_subjective),
               "subjective contracts may not call non-subjective ones");

      auto& bc = impl->transactionContext.blockContext;
      if ((impl->contractAccount.flags & account_row::is_subjective) && !bc.isProducing)
      {
         check(bc.nextSubjectiveRead < bc.current.subjectiveData.size(), "missing subjective data");
         impl->currentActContext->actionTrace.rawRetval =
             bc.current.subjectiveData[bc.nextSubjectiveRead++];
         return;
      }

      impl->exec(actionContext, [&] {  //
         (*impl->backend)(*impl, "env", "called", actionContext.action.contract.value,
                          actionContext.action.sender.value);
      });

      if ((impl->contractAccount.flags & account_row::is_subjective) &&
          !(callerFlags & account_row::is_subjective))
         bc.current.subjectiveData.push_back(impl->currentActContext->actionTrace.rawRetval);
   }

   void ExecutionContext::execVerify(ActionContext& actionContext)
   {
      impl->exec(actionContext, [&] {  //
         // auto startTime = std::chrono::steady_clock::now();
         (*impl->backend)(*impl, "env", "verify");
         // auto us = std::chrono::duration_cast<std::chrono::microseconds>(
         //     std::chrono::steady_clock::now() - startTime);
         // std::cout << "verify: " << us.count() << " us\n";
      });
   }

   void ExecutionContext::execServe(ActionContext& actionContext)
   {
      impl->exec(actionContext, [&] {  //
         (*impl->backend)(*impl, "env", "serve");
      });
   }

   void ExecutionContext::asyncTimeout()
   {
      if (impl->contractAccount.flags & account_row::can_not_time_out)
         return;
      impl->timedOut = true;
      impl->backend->get_module().allocator.disable_code();
   }
}  // namespace psibase
