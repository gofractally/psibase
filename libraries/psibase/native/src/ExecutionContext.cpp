#include <psibase/NativeFunctions.hpp>

#include <atomic>
#include <boost/multi_index/key.hpp>
#include <boost/multi_index/ordered_index.hpp>
#include <boost/multi_index/sequenced_index.hpp>
#include <boost/multi_index_container.hpp>
#include <debug_eos_vm/debug_eos_vm.hpp>
#include <eosio/vm/backend.hpp>
#include <mutex>
#include <psibase/ActionContext.hpp>
#include <psibase/db.hpp>
#include <psio/finally.hpp>
#include <psio/from_bin.hpp>

namespace bmi = boost::multi_index;

using eosio::vm::span;

namespace psibase
{
   struct ExecutionContextImpl;
   using rhf_t = eosio::vm::registered_host_functions<ExecutionContextImpl>;
#ifdef __x86_64__
   using backend_t = eosio::vm::backend<rhf_t, eosio::vm::jit_profile, VMOptions>;
#else
   using backend_t = eosio::vm::backend<rhf_t, eosio::vm::interpreter, VMOptions>;
#endif

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
      database.kvPut(CodeByHashRow::db, codeObj->key(), *codeObj);
   }  // setCode

   struct BackendEntry
   {
      Checksum256                hash;
      VMOptions                  vmOptions;
      std::unique_ptr<backend_t> backend;
#ifdef __x86_64__
      std::shared_ptr<dwarf::debugger_registration> debug;
#endif

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

      BackendEntry get(const Checksum256& hash, const VMOptions& vmOptions)
      {
         BackendEntry                result{hash, vmOptions};
         std::lock_guard<std::mutex> lock{mutex};
         auto&                       ind = backends.get<ByHash>();
         auto                        it  = ind.find(std::tie(hash, vmOptions));
         if (it == ind.end())
            return result;
         ind.modify(it, [&](auto& x) { result = std::move(x); });
         ind.erase(it);
         result.backend->get_module().allocator.enable_code(true);
         return result;
      }
   };

   WasmCache::WasmCache(uint32_t cacheSize) : impl{std::make_shared<WasmCacheImpl>(cacheSize)} {}

   WasmCache::WasmCache(const WasmCache& src) : impl{src.impl} {}

   WasmCache::WasmCache(WasmCache&& src) : impl{std::move(src.impl)} {}

   WasmCache::~WasmCache() {}

   std::vector<std::span<const char>> WasmCache::span() const
   {
      std::vector<std::span<const char>> result;
      std::lock_guard                    lock{impl->mutex};
      for (const auto& backend : impl->backends)
      {
         auto& alloc = backend.backend->get_module().allocator;
         result.push_back({alloc._base, alloc._capacity});
         result.push_back({alloc._code_base, alloc._code_size});
      }
      return result;
   }

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

   std::span<const char> ExecutionMemory::span() const
   {
      auto        raw         = impl->wa.get_base_ptr<const char>();
      std::size_t syspagesize = static_cast<std::size_t>(::sysconf(_SC_PAGESIZE));
      return {raw - syspagesize, eosio::vm::max_memory + 2 * syspagesize};
   }

   // TODO: debugger
   struct ExecutionContextImpl : NativeFunctions
   {
      VMOptions                                     vmOptions;
      eosio::vm::wasm_allocator&                    wa;
      BackendEntry                                  backend;
      std::shared_ptr<dwarf::debugger_registration> dbg;
      std::atomic<bool>                             timedOut    = false;
      bool                                          initialized = false;

      ExecutionContextImpl(TransactionContext& transactionContext,
                           const VMOptions&    vmOptions,
                           ExecutionMemory&    memory,
                           AccountNumber       service)
          : NativeFunctions{transactionContext.blockContext.db, transactionContext,
                            transactionContext.dbMode},
            vmOptions{vmOptions},
            wa{memory.impl->wa}
      {
         database.checkoutSubjective();
         psio::finally _{[&] { database.abortSubjective(); }};
         auto [ca, db] = getCode(service);

         code   = std::move(ca);
         auto c = database.kvGet<CodeByHashRow>(
             db, codeByHashKey(code.codeHash, code.vmType, code.vmVersion));
         check(c.has_value(), "service code record is missing");
         check(c->vmType == 0, "vmType is not 0");
         check(c->vmVersion == 0, "vmVersion is not 0");
         if (transactionContext.dbMode.verifyOnly)
         {
            check(code.flags & CodeRow::isVerify,
                  "service account " + service.str() + " cannot be used in verify mode");
            // Ignore all other flags
            code.flags &= CodeRow::isVerify;
         }
         rethrowVMExcept(
             [&]
             {
                backend = transactionContext.blockContext.systemContext.wasmCache.impl->get(
                    code.codeHash, vmOptions);
                if (!backend.backend)
                {
                   psio::input_stream s{reinterpret_cast<const char*>(c->code.data()),
                                        c->code.size()};
#ifdef __x86_64__
                   if (dwarf::has_debug_info(s))
                   {
                      debug_eos_vm::debug_instr_map debug;
                      backend.backend =
                          std::make_unique<backend_t>(c->code, nullptr, vmOptions, debug);
                      auto info     = dwarf::get_info_from_wasm(s);
                      backend.debug = dwarf::register_with_debugger(
                          info, debug.locs, backend.backend->get_module(), s);
                   }
                   else
                   {
                      backend.backend = std::make_unique<backend_t>(c->code, nullptr, vmOptions);
                      backend.debug = dwarf::register_with_debugger(backend.backend->get_module());
                   }
#else
                   backend.backend = std::make_unique<backend_t>(c->code, nullptr, vmOptions);
#endif
                }
             });
      }

      ~ExecutionContextImpl()
      {
         transactionContext.blockContext.systemContext.wasmCache.impl->add(std::move(backend));
      }

      eosio::vm::stack_manager& getAltStack() { return transactionContext.getAltStack(); }

      std::pair<CodeRow, DbId> getCode(AccountNumber service)
      {
         if (dbMode.isSubjective)
         {
            // Check subjective first, then objective
            {
               auto ca = database.kvGet<CodeRow>(DbId::nativeSubjective, codeKey(service));
               if (ca.has_value() && ca->codeHash != Checksum256{})
               {
                  ca->flags &= CodeRow::localServiceFlags;
                  ca->flags |= ExecutionContext::isLocal;
                  return {std::move(*ca), DbId::nativeSubjective};
               }
            }
            auto ca = database.kvGet<CodeRow>(DbId::native, codeKey(service));
            check(ca.has_value(), "unknown service account: " + service.str());
            check(ca->codeHash != Checksum256{}, "service account has no code");
            ca->flags &= CodeRow::chainServiceFlags;
            return {std::move(*ca), DbId::native};
         }
         else
         {
            // Use objective service unless it has the isSubjective flag
            auto ca = database.kvGet<CodeRow>(DbId::native, codeKey(service));
            check(ca.has_value(), "unknown service account: " + service.str());
            check(ca->codeHash != Checksum256{}, "service account has no code");
            ca->flags &= CodeRow::chainServiceFlags;
            auto runMode = ca->flags & CodeRow::runMode;
            if (runMode && !dbMode.verifyOnly)
            {
               check((ca->flags & CodeRow::runMode) <= CodeRow::runModeCallback, "Invalid runMode");
               auto subjectiveCode =
                   database.kvGet<CodeRow>(DbId::nativeSubjective, codeKey(service));
               if (subjectiveCode.has_value() && subjectiveCode->codeHash != Checksum256{})
               {
                  if (!(subjectiveCode->flags & CodeRow::isReplacement))
                     abortMessage("Cannot substitute subjective service for " + service.str());
                  subjectiveCode->flags &= CodeRow::localServiceFlags;
                  subjectiveCode->flags |= (ca->flags & ~CodeRow::localServiceFlags);
                  subjectiveCode->flags |= ExecutionContext::isLocal;
                  return {std::move(*subjectiveCode), DbId::nativeSubjective};
               }
            }
            return {std::move(*ca), DbId::native};
         }
      }

      void init()
      {
         rethrowVMExcept(
             [&]
             {
                // auto startTime = std::chrono::steady_clock::now();
                backend.backend->set_wasm_allocator(&wa);
                backend.backend->initialize(getAltStack(), this);
                (*backend.backend)(getAltStack(), *this, "env", "start",
                                   currentActContext->action.service.value);
                initialized = true;
                // auto us     = std::chrono::duration_cast<std::chrono::microseconds>(
                //     std::chrono::steady_clock::now() - startTime);
                // std::cout << "init:   " << us.count() << " us\n";
             });
      }

      struct RecordActionTime
      {
         explicit RecordActionTime(ActionContext& actionContext) : actionContext(actionContext)
         {
            actionContext.actionTrace.totalTime =
                actionContext.transactionContext.getBillableTime();
         }
         ~RecordActionTime()
         {
            actionContext.actionTrace.totalTime =
                actionContext.transactionContext.getBillableTime() -
                actionContext.actionTrace.totalTime;
         }
         ActionContext& actionContext;
      };

      template <typename F>
      void exec(ActionContext& actionContext, F f)
      {
         auto prev         = currentActContext;
         currentActContext = &actionContext;
         RecordActionTime timer{actionContext};
         try
         {
            backend.backend->get_context().set_max_call_depth(
                actionContext.transactionContext.remainingStack);
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
      impl->currentExecContext = this;
   }

   ExecutionContext::ExecutionContext(ExecutionContext&& src)
   {
      impl                     = std::move(src.impl);
      impl->currentExecContext = this;
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
      rhf_t::add<&ExecutionContextImpl::clockTimeGet>("env", "clockTimeGet");
      rhf_t::add<&ExecutionContextImpl::getRandom>("env", "getRandom");
      rhf_t::add<&ExecutionContextImpl::setMaxTransactionTime>("env", "setMaxTransactionTime");
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
      rhf_t::add<&ExecutionContextImpl::checkoutSubjective>("env", "checkoutSubjective");
      rhf_t::add<&ExecutionContextImpl::commitSubjective>("env", "commitSubjective");
      rhf_t::add<&ExecutionContextImpl::abortSubjective>("env", "abortSubjective");
      rhf_t::add<&ExecutionContextImpl::socketSend>("env", "socketSend");
      rhf_t::add<&ExecutionContextImpl::socketAutoClose>("env", "socketAutoClose");
   }

   std::uint32_t ExecutionContext::remainingStack() const
   {
      return impl->backend.backend->get_context().get_remaining_call_depth();
   }

   void ExecutionContext::execProcessTransaction(ActionContext& actionContext)
   {
      impl->exec(actionContext, [&] {  //
         (*impl->backend.backend)(impl->getAltStack(), *impl, "env", "processTransaction");
      });
   }

   void ExecutionContext::execCalled(uint64_t callerFlags, ActionContext& actionContext)
   {
      // Prevents a poison block
      if (callerFlags & CodeRow::runMode && !actionContext.transactionContext.dbMode.isSubjective)
      {
         check(impl->code.flags & CodeRow::runMode,
               "subjective services may not call non-subjective ones");
         check((callerFlags & CodeRow::runMode) == (impl->code.flags & CodeRow::runMode),
               "subjective services that call each other must have the same replay mode");
      }

      if ((callerFlags & (callerSudo | isLocal)) == callerSudo)
      {
         check((impl->code.flags & (isLocal | CodeRow::isReplacement)) != isLocal,
               "on-chain service cannot sudo when calling a node-local service");
      }

      auto& bc = impl->transactionContext.blockContext;
      if ((impl->code.flags & CodeRow::runMode) && !bc.isProducing)
      {
         if ((impl->code.flags & CodeRow::runMode) == CodeRow::runModeCallback)
         {
            try
            {
               impl->exec(actionContext, [&] {  //
                  (*impl->backend.backend)(impl->getAltStack(), *impl, "env", "called",
                                           actionContext.action.service.value,
                                           actionContext.action.sender.value);
               });
            }
            catch (...)
            {
               // If the service is called again, reinitialize it, to prevent corruption
               // from resuming after abrupt termination.
               impl->initialized = false;
               if ((callerFlags & CodeRow::runMode) == CodeRow::runModeCallback)
                  throw;
            }
            // Don't override the return value if the caller is also subjective
            if (callerFlags & CodeRow::runMode)
            {
               return;
            }
         }
         auto&       ctx = impl->transactionContext;
         const auto& tx  = ctx.signedTransaction;
         check(ctx.nextSubjectiveRead < tx.subjectiveData->size(), "missing subjective data");
         actionContext.actionTrace.rawRetval = (*tx.subjectiveData)[ctx.nextSubjectiveRead++];
         return;
      }

      impl->exec(actionContext, [&] {  //
         (*impl->backend.backend)(impl->getAltStack(), *impl, "env", "called",
                                  actionContext.action.service.value,
                                  actionContext.action.sender.value);
      });

      if ((impl->code.flags & CodeRow::runMode) && !(callerFlags & CodeRow::runMode))
         impl->transactionContext.subjectiveData.push_back(actionContext.actionTrace.rawRetval);
   }

   void ExecutionContext::execServe(ActionContext& actionContext)
   {
      impl->exec(actionContext, [&] {  //
         (*impl->backend.backend)(impl->getAltStack(), *impl, "env", "serve");
      });
   }

   void ExecutionContext::exec(ActionContext& actionContext, std::string_view fn)
   {
      impl->exec(actionContext, [&] {  //
         (*impl->backend.backend)(impl->getAltStack(), *impl, "env", fn);
      });
   }

   void ExecutionContext::asyncTimeout()
   {
      impl->timedOut = true;
      impl->backend.backend->get_module().allocator.disable_code();
   }
}  // namespace psibase
