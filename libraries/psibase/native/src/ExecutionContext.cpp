#include <psibase/NativeFunctions.hpp>

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
   struct ExecutionContextImpl : NativeFunctions
   {
      eosio::vm::wasm_allocator& wa;
      std::unique_ptr<backend_t> backend;
      std::atomic<bool>          timedOut    = false;
      bool                       initialized = false;

      ExecutionContextImpl(TransactionContext& transactionContext,
                           ExecutionMemory&    memory,
                           AccountNumber       contract)
          : NativeFunctions{transactionContext.blockContext.db, transactionContext,
                            transactionContext.blockContext.isReadOnly},
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
