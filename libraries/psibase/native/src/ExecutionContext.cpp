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
   void setCode(Database&          database,
                AccountNumber      contract,
                uint8_t            vmType,
                uint8_t            vmVersion,
                psio::input_stream code)
   {
      check(code.remaining(), "native setCode can't clear code");
      auto codeHash = sha256(code.pos, code.remaining());

      auto account = database.kvGet<AccountRow>(AccountRow::db, accountKey(contract));
      check(account.has_value(), "setCode: unknown contract account");
      check(account->codeHash == Checksum256{}, "native setCode can't replace code");
      account->codeHash  = codeHash;
      account->vmType    = vmType;
      account->vmVersion = vmVersion;
      database.kvPut(AccountRow::db, account->key(), *account);

      auto codeObj = database.kvGet<codeRow>(codeRow::db, codeKey(codeHash, vmType, vmVersion));
      if (!codeObj)
      {
         codeObj.emplace();
         codeObj->codeHash  = codeHash;
         codeObj->vmType    = vmType;
         codeObj->vmVersion = vmVersion;
         codeObj->code.assign(code.pos, code.end);
      }
      ++codeObj->numRefs;
      database.kvPut(codeRow::db, codeObj->key(), *codeObj);
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
      Database&                  database;
      TransactionContext&        transactionContext;
      eosio::vm::wasm_allocator& wa;
      std::unique_ptr<backend_t> backend;
      std::atomic<bool>          timedOut = false;
      AccountRow                 contractAccount;
      bool                       initialized       = false;
      ActionContext*             currentActContext = nullptr;  // Changes during recursion

      ExecutionContextImpl(TransactionContext& transactionContext,
                           ExecutionMemory&    memory,
                           AccountNumber       contract)
          : database{transactionContext.blockContext.db},
            transactionContext{transactionContext},
            wa{memory.impl->wa}
      {
         auto ca = database.kvGet<AccountRow>(AccountRow::db, accountKey(contract));
         check(ca.has_value(), "unknown contract account");
         check(ca->codeHash != Checksum256{}, "account has no code");
         contractAccount = std::move(*ca);
         auto code       = database.kvGet<codeRow>(
             codeRow::db,
             codeKey(contractAccount.codeHash, contractAccount.vmType, contractAccount.vmVersion));
         check(code.has_value(), "code record is missing");
         check(code->vmType == 0, "vmType is not 0");
         check(code->vmVersion == 0, "vmVersion is not 0");
         rethrowVMExcept(
             [&]
             {
                backend = transactionContext.blockContext.systemContext.wasmCache.impl->get(
                    contractAccount.codeHash);
                if (!backend)
                   backend = std::make_unique<backend_t>(code->code, nullptr);
             });
      }

      ~ExecutionContextImpl()
      {
         transactionContext.blockContext.systemContext.wasmCache.impl->add(
             {contractAccount.codeHash, std::move(backend)});
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

      template <typename F>
      auto timeDb(F f)
      {
         auto start  = std::chrono::steady_clock::now();
         auto result = f();
         currentActContext->transactionContext.databaseTime +=
             std::chrono::steady_clock::now() - start;
         return result;
      }

      template <typename F>
      void timeDbVoid(F f)
      {
         auto start = std::chrono::steady_clock::now();
         f();
         currentActContext->transactionContext.databaseTime +=
             std::chrono::steady_clock::now() - start;
      }

      DbId getDbRead(uint32_t db)
      {
         if (db == uint32_t(DbId::contract))
            return (DbId)db;
         if (db == uint32_t(DbId::nativeConstrained))
            return (DbId)db;
         if (db == uint32_t(DbId::nativeUnconstrained))
            return (DbId)db;
         if (db == uint32_t(DbId::subjective))
         {
            // TODO: RPC contract queries currently can read subjective data to monitor node status.
            //       However, there's a possibility this may make it easier on an active attacker.
            //       Make this capability a node configuration toggle? Allow node config to whitelist
            //       contracts for this?
            if ((contractAccount.flags & AccountRow::isSubjective) ||
                transactionContext.blockContext.isReadOnly)
               return (DbId)db;
         }
         if (db == uint32_t(DbId::writeOnly) && transactionContext.blockContext.isReadOnly)
            return (DbId)db;
         if (db == uint32_t(DbId::blockLog) && transactionContext.blockContext.isReadOnly)
            return (DbId)db;
         throw std::runtime_error("contract may not read this db, or must use another intrinsic");
      }

      DbId getDbReadSequential(uint32_t db)
      {
         if (transactionContext.blockContext.isReadOnly ||
             (contractAccount.flags & AccountRow::isSubjective))
         {
            if (db == uint32_t(DbId::historyEvent))
               return (DbId)db;
            if (db == uint32_t(DbId::uiEvent))
               return (DbId)db;
         }
         throw std::runtime_error("contract may not read this db, or must use another intrinsic");
      }

      bool keyHasContractPrefix(uint32_t db)
      {
         return db == uint32_t(DbId::contract) || db == uint32_t(DbId::writeOnly) ||
                db == uint32_t(DbId::subjective);
      }

      struct Writable
      {
         DbId db;
         bool readable;
      };

      Writable getDbWrite(uint32_t db, psio::input_stream key)
      {
         check(!transactionContext.blockContext.isReadOnly, "writes disabled during query");

         if (keyHasContractPrefix(db))
         {
            uint64_t prefix = contractAccount.num.value;
            std::reverse(reinterpret_cast<char*>(&prefix), reinterpret_cast<char*>(&prefix + 1));
            check(key.remaining() >= sizeof(prefix) && !memcmp(key.pos, &prefix, sizeof(prefix)),
                  "key prefix must match contract during write");
         };

         if (db == uint32_t(DbId::subjective) && (contractAccount.flags & AccountRow::isSubjective))
            return {(DbId)db, true};

         // Prevent poison block; subjective contracts skip execution during replay
         check(!(contractAccount.flags & AccountRow::isSubjective),
               "subjective contracts may only write to DbId::subjective");

         if (db == uint32_t(DbId::contract) || db == uint32_t(DbId::writeOnly))
            return {(DbId)db, false};
         if (db == uint32_t(DbId::nativeConstrained) &&
             (contractAccount.flags & AccountRow::allowWriteNative))
            return {(DbId)db, true};
         if (db == uint32_t(DbId::nativeUnconstrained) &&
             (contractAccount.flags & AccountRow::allowWriteNative))
            return {(DbId)db, true};
         throw std::runtime_error("contract may not write this db (" + std::to_string(db) +
                                  "), or must use another intrinsic");
      }

      DbId getDbWriteSequential(uint32_t db)
      {
         check(!transactionContext.blockContext.isReadOnly, "writes disabled during query");

         // Prevent poison block; subjective contracts skip execution during replay
         check(!(contractAccount.flags & AccountRow::isSubjective),
               "contract may not write this db, or must use another intrinsic");

         if (db == uint32_t(DbId::historyEvent))
            return (DbId)db;
         if (db == uint32_t(DbId::uiEvent))
            return (DbId)db;
         throw std::runtime_error("contract may not write this db (" + std::to_string(db) +
                                  "), or must use another intrinsic");
      }

      void verifyWriteConstrained(psio::input_stream key, psio::input_stream value)
      {
         // Currently, code is the only table which lives in nativeConstrained
         // which is writable by contracts. The other tables aren't writable by
         // contracts.
         //
         // TODO: use a view here instead of unpacking to a rich object
         // TODO: verify fracpack; no unknown
         auto code     = psio::convert_from_frac<codeRow>(psio::input_stream(value.pos, value.end));
         auto codeHash = sha256(code.code.data(), code.code.size());
         check(code.codeHash == codeHash, "codeRow has incorrect codeHash");
         auto expected_key = psio::convert_to_key(code.key());
         check(key.remaining() == expected_key.size() &&
                   !memcmp(key.pos, expected_key.data(), key.remaining()),
               "codeRow has incorrect key");
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
         check(contractAccount.flags & AccountRow::isSubjective,
               "unprivileged contracts may not call getBillableTime");
         return transactionContext.getBillableTime().count();
      }

      void setMaxTransactionTime(uint64_t nanoseconds)
      {
         check(contractAccount.flags & AccountRow::canSetTimeLimit,
               "setMaxTransactionTime requires canSetTimeLimit privilege");
         if (transactionContext.blockContext.isProducing)
            transactionContext.setWatchdog(
                std::chrono::duration_cast<std::chrono::steady_clock::duration>(
                    std::chrono::nanoseconds{nanoseconds}));
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
         // TODO: verify no extra data
         check(psio::fracvalidate<Action>(data.data(), data.end()).valid_and_known(),
               "call: invalid data format");
         auto act = psio::convert_from_frac<Action>({data.data(), data.size()});
         check(act.sender == contractAccount.num || (contractAccount.flags & AccountRow::allowSudo),
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
      void kvPut(uint32_t db, span<const char> key, span<const char> value)
      {
         timeDbVoid(
             [&]
             {
                if (db == uint32_t(DbId::nativeConstrained))
                   verifyWriteConstrained({key.data(), key.size()}, {value.data(), value.size()});
                clearResult();
                auto [m, readable] = getDbWrite(db, {key.data(), key.size()});
                if (!(contractAccount.flags & AccountRow::isSubjective))
                {
                   auto& delta =
                       transactionContext.kvResourceDeltas[KvResourceKey{contractAccount.num, db}];
                   delta.records += 1;
                   delta.keyBytes += key.size();
                   delta.valueBytes += value.size();
                   if (readable)
                   {
                      if (auto existing = database.kvGetRaw(m, {key.data(), key.size()}))
                      {
                         delta.records -= 1;
                         delta.keyBytes -= key.size();
                         delta.valueBytes -= existing->remaining();
                      }
                   }
                }
                database.kvPutRaw(m, {key.data(), key.size()}, {value.data(), value.size()});
             });
      }

      // TODO: restrict value size
      uint64_t kvPutSequential(uint32_t db, span<const char> value)
      {
         return timeDb(
             [&]
             {
                clearResult();
                auto m = getDbWriteSequential(db);

                if (!(contractAccount.flags & AccountRow::isSubjective))
                {
                   auto& delta =
                       transactionContext.kvResourceDeltas[KvResourceKey{contractAccount.num, db}];
                   delta.records += 1;
                   delta.keyBytes += sizeof(uint64_t);
                   delta.valueBytes += value.size();
                }

                psio::input_stream v{value.data(), value.size()};
                check(v.remaining() >= sizeof(AccountNumber::value),
                      "value prefix must match contract during write");
                auto contract = psio::from_bin<AccountNumber>(v);
                check(contract == contractAccount.num,
                      "value prefix must match contract during write");

                auto&    dbStatus = transactionContext.blockContext.databaseStatus;
                uint64_t indexNumber;
                if (db == uint32_t(DbId::historyEvent))
                   indexNumber = dbStatus.nextHistoryEventNumber++;
                else if (db == uint32_t(DbId::uiEvent))
                   indexNumber = dbStatus.nextUIEventNumber++;
                else
                   check(false, "kvPutSequential: unsupported db");
                database.kvPut(DatabaseStatusRow::db, dbStatus.key(), dbStatus);

                database.kvPutRaw(m, psio::convert_to_key(indexNumber),
                                  {value.data(), value.size()});
                return indexNumber;
             });
      }  // kvPutSequential()

      void kvRemove(uint32_t db, span<const char> key)
      {
         timeDbVoid(
             [&]
             {
                clearResult();
                auto [m, readable] = getDbWrite(db, {key.data(), key.size()});
                if (readable && !(contractAccount.flags & AccountRow::isSubjective))
                {
                   if (auto existing = database.kvGetRaw(m, {key.data(), key.size()}))
                   {
                      auto& delta = transactionContext
                                        .kvResourceDeltas[KvResourceKey{contractAccount.num, db}];
                      delta.records -= 1;
                      delta.keyBytes -= key.size();
                      delta.valueBytes -= existing->remaining();
                   }
                }
                database.kvRemoveRaw(m, {key.data(), key.size()});
             });
      }

      uint32_t kvGet(uint32_t db, span<const char> key)
      {
         return timeDb(
             [&] {
                return setResult(database.kvGetRaw(getDbRead(db), {key.data(), key.size()}));
             });
      }

      uint32_t kvGetSequential(uint32_t db, uint64_t indexNumber)
      {
         return timeDb(
             [&]
             {
                auto m = getDbReadSequential(db);
                return setResult(database.kvGetRaw(m, psio::convert_to_key(indexNumber)));
             });
      }

      uint32_t kvGreaterEqual(uint32_t db, span<const char> key, uint32_t matchKeySize)
      {
         return timeDb(
             [&]
             {
                check(matchKeySize <= key.size(), "matchKeySize is larger than key");
                if (keyHasContractPrefix(db))
                   check(matchKeySize >= sizeof(AccountNumber::value),
                         "matchKeySize is smaller than 8 bytes");
                return setResult(database.kvGreaterEqualRaw(getDbRead(db), {key.data(), key.size()},
                                                            matchKeySize));
             });
      }

      uint32_t kvLessThan(uint32_t db, span<const char> key, uint32_t matchKeySize)
      {
         return timeDb(
             [&]
             {
                check(matchKeySize <= key.size(), "matchKeySize is larger than key");
                if (keyHasContractPrefix(db))
                   check(matchKeySize >= sizeof(AccountNumber::value),
                         "matchKeySize is smaller than 8 bytes");
                return setResult(
                    database.kvLessThanRaw(getDbRead(db), {key.data(), key.size()}, matchKeySize));
             });
      }

      uint32_t kvMax(uint32_t db, span<const char> key)
      {
         return timeDb(
             [&]
             {
                if (keyHasContractPrefix(db))
                   check(key.size() >= sizeof(AccountNumber::value), "key is shorter than 8 bytes");
                return setResult(database.kvMaxRaw(getDbRead(db), {key.data(), key.size()}));
             });
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
      rhf_t::add<&ExecutionContextImpl::setMaxTransactionTime>("env", "setMaxTransactionTime");
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
      if (!(impl->contractAccount.flags & AccountRow::isSubjective))
         check(!(callerFlags & AccountRow::isSubjective),
               "subjective contracts may not call non-subjective ones");

      auto& bc = impl->transactionContext.blockContext;
      if ((impl->contractAccount.flags & AccountRow::isSubjective) && !bc.isProducing)
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

      if ((impl->contractAccount.flags & AccountRow::isSubjective) &&
          !(callerFlags & AccountRow::isSubjective))
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
      if (impl->contractAccount.flags & AccountRow::canNotTimeOut)
         return;
      impl->timedOut = true;
      impl->backend->get_module().allocator.disable_code();
   }
}  // namespace psibase
