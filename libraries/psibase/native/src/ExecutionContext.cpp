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
   using backend_t = eosio::vm::backend<rhf_t, eosio::vm::jit, VMOptions>;

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
                AccountNumber      service,
                uint8_t            vmType,
                uint8_t            vmVersion,
                psio::input_stream code)
   {
      check(code.remaining(), "native setCode can't clear code");
      auto codeHash = sha256(code.pos, code.remaining());

      auto account = database.kvGet<CodeRow>(CodeRow::db, codeKey(service));
      check(account.has_value(), "setCode: unknown service account");
      check(account->codeHash == Checksum256{}, "native setCode can't replace code");
      account->codeHash  = codeHash;
      account->vmType    = vmType;
      account->vmVersion = vmVersion;
      database.kvPut(CodeRow::db, account->key(), *account);

      auto codeObj = database.kvGet<CodeByHashRow>(CodeByHashRow::db,
                                                   codeByHashKey(codeHash, vmType, vmVersion));
      if (!codeObj)
      {
         codeObj.emplace();
         codeObj->codeHash  = codeHash;
         codeObj->vmType    = vmType;
         codeObj->vmVersion = vmVersion;
         codeObj->code.assign(code.pos, code.end);
      }
      ++codeObj->numRefs;
      database.kvPut(CodeByHashRow::db, codeObj->key(), *codeObj);
   }  // setCode

   struct BackendEntry
   {
      Checksum256                hash;
      VMOptions                  vmOptions;
      std::unique_ptr<backend_t> backend;

      auto byHash() const { return std::tie(hash, vmOptions); }
   };

   struct ByAge;
   struct ByHash;

   using BackendContainer = bmi::multi_index_container<
       BackendEntry,
       bmi::indexed_by<bmi::sequenced<bmi::tag<ByAge>>,
                       bmi::ordered_non_unique<bmi::tag<ByHash>, bmi::key<&BackendEntry::byHash>>>>;

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

      std::unique_ptr<backend_t> get(const Checksum256& hash, const VMOptions& vmOptions)
      {
         std::unique_ptr<backend_t>  result;
         std::lock_guard<std::mutex> lock{mutex};
         auto&                       ind = backends.get<ByHash>();
         auto                        it  = ind.find(std::tie(hash, vmOptions));
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
      VMOptions                  vmOptions;
      eosio::vm::wasm_allocator& wa;
      std::unique_ptr<backend_t> backend;
      std::atomic<bool>          timedOut    = false;
      bool                       initialized = false;

      ExecutionContextImpl(TransactionContext& transactionContext,
                           const VMOptions&    vmOptions,
                           ExecutionMemory&    memory,
                           AccountNumber       service)
          : NativeFunctions{transactionContext.blockContext.db, transactionContext,
                            transactionContext.allowDbRead, transactionContext.allowDbWrite,
                            transactionContext.allowDbReadSubjective},
            vmOptions{vmOptions},
            wa{memory.impl->wa}
      {
         auto ca = database.kvGet<CodeRow>(CodeRow::db, codeKey(service));
         check(ca.has_value(), "unknown service account");
         check(ca->codeHash != Checksum256{}, "account has no code");
         code   = std::move(*ca);
         auto c = database.kvGet<CodeByHashRow>(
             CodeByHashRow::db, codeByHashKey(code.codeHash, code.vmType, code.vmVersion));
         check(c.has_value(), "code record is missing");
         check(c->vmType == 0, "vmType is not 0");
         check(c->vmVersion == 0, "vmVersion is not 0");
         rethrowVMExcept(
             [&]
             {
                backend = transactionContext.blockContext.systemContext.wasmCache.impl->get(
                    code.codeHash, vmOptions);
                if (!backend)
                   backend = std::make_unique<backend_t>(c->code, nullptr, vmOptions);
             });
      }

      ~ExecutionContextImpl()
      {
         transactionContext.blockContext.systemContext.wasmCache.impl->add(
             {code.codeHash, vmOptions, std::move(backend)});
      }

      void init()
      {
         rethrowVMExcept(
             [&]
             {
                // auto startTime = std::chrono::steady_clock::now();
                backend->set_wasm_allocator(&wa);
                backend->initialize(this);
                (*backend)(*this, "env", "start", currentActContext->action.service.value);
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
                                      const VMOptions&    vmOptions,
                                      ExecutionMemory&    memory,
                                      AccountNumber       service)
   {
      impl = std::make_unique<ExecutionContextImpl>(transactionContext, vmOptions, memory, service);
   }

   ExecutionContext::ExecutionContext(ExecutionContext&& src)
   {
      impl = std::move(src.impl);
   }
   ExecutionContext::~ExecutionContext() {}

   void ExecutionContext::registerHostFunctions()
   {
      // TODO: enable linking to disabled functions below after we finalize
      //       their interfaces. Disabling now simplifies future upgrades.

      rhf_t::add<&ExecutionContextImpl::getResult>("env", "getResult");
      rhf_t::add<&ExecutionContextImpl::getKey>("env", "getKey");
      rhf_t::add<&ExecutionContextImpl::writeConsole>("env", "writeConsole");
      rhf_t::add<&ExecutionContextImpl::abortMessage>("env", "abortMessage");
      // rhf_t::add<&ExecutionContextImpl::getBillableTime>("env", "getBillableTime");
      // rhf_t::add<&ExecutionContextImpl::setMaxTransactionTime>("env", "setMaxTransactionTime");
      rhf_t::add<&ExecutionContextImpl::getCurrentAction>("env", "getCurrentAction");
      rhf_t::add<&ExecutionContextImpl::call>("env", "call");
      rhf_t::add<&ExecutionContextImpl::setRetval>("env", "setRetval");
      rhf_t::add<&ExecutionContextImpl::kvPut>("env", "kvPut");
      rhf_t::add<&ExecutionContextImpl::putSequential>("env", "putSequential");
      rhf_t::add<&ExecutionContextImpl::kvRemove>("env", "kvRemove");
      rhf_t::add<&ExecutionContextImpl::kvGet>("env", "kvGet");
      rhf_t::add<&ExecutionContextImpl::getSequential>("env", "getSequential");
      rhf_t::add<&ExecutionContextImpl::kvGreaterEqual>("env", "kvGreaterEqual");
      rhf_t::add<&ExecutionContextImpl::kvLessThan>("env", "kvLessThan");
      rhf_t::add<&ExecutionContextImpl::kvMax>("env", "kvMax");
      // rhf_t::add<&ExecutionContextImpl::kvGetTransactionUsage>("env", "kvGetTransactionUsage");
   }

   void ExecutionContext::execProcessTransaction(ActionContext& actionContext)
   {
      impl->exec(actionContext, [&] {  //
         (*impl->backend)(*impl, "env", "processTransaction");
      });
   }

   void ExecutionContext::execCalled(uint64_t callerFlags, ActionContext& actionContext)
   {
      // Prevents a poison block
      if (!(impl->code.flags & CodeRow::isSubjective))
         check(!(callerFlags & CodeRow::isSubjective),
               "subjective services may not call non-subjective ones");

      auto& bc = impl->transactionContext.blockContext;
      if ((impl->code.flags & CodeRow::isSubjective) && !bc.isProducing)
      {
         check(bc.nextSubjectiveRead < bc.current.subjectiveData.size(), "missing subjective data");
         impl->currentActContext->actionTrace.rawRetval =
             bc.current.subjectiveData[bc.nextSubjectiveRead++];
         return;
      }

      impl->exec(actionContext, [&] {  //
         (*impl->backend)(*impl, "env", "called", actionContext.action.service.value,
                          actionContext.action.sender.value);
      });

      if ((impl->code.flags & CodeRow::isSubjective) && !(callerFlags & CodeRow::isSubjective))
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
      if (impl->code.flags & CodeRow::canNotTimeOut)
         return;
      impl->timedOut = true;
      impl->backend->get_module().allocator.disable_code();
   }
}  // namespace psibase
