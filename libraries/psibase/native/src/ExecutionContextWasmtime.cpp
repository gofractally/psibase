// The node's execution engine when PSIBASE_VM_BACKEND=WASMTIME.
//
// wasmtime (Cranelift) executes; psizam decides what may execute. Every
// service still passes validateNativeWasm and psizam's parser under
// NativeVMOptions, so limits and enabled proposals are the chain policy. That
// parse also yields psizam's per-function stack costs, which are compiled into
// the module so the stack-overflow point is the same as on psizam's engines.
//
// This file implements the same interface as ExecutionContext.cpp; exactly one
// of the two is built.

#include <psibase/NativeFunctions.hpp>

#include <atomic>
#include <list>
#include <map>
#include <mutex>
#include <optional>
#include <psibase/ActionContext.hpp>
#include <psibase/PsizamPolicy.hpp>
#include <psibase/db.hpp>
#include <psio/finally.hpp>
#include <psizam/wasmtime_admission.hpp>
#include <psizam/wasmtime_backend.hpp>

namespace wt = psizam::wasmtime;

// Pointer arguments the host ABI takes through psizam's unaligned proxy: one
// i32 offset into linear memory, checked for sizeof(T) bytes.
template <typename T>
struct wt::detail::value_traits<psizam::detail::argument_proxy<T*>>
{
   static constexpr std::array<uint8_t, 1> types{type_i32};
   static constexpr bool                   reads_memory = true;
   static psizam::detail::argument_proxy<T*> load(const abi::PzwtValue* v, memory_view m)
   {
      std::uint64_t ptr = static_cast<std::uint32_t>(v->i32);
      if (ptr > m.size || sizeof(T) > m.size - ptr)
         throw host_memory_error("host pointer is outside linear memory");
      return {m.base + ptr};
   }
};

namespace psibase
{
   struct ExecutionContextImpl;

   namespace
   {
      // Native stack for wasm, per executing thread. The byte budget
      // (max_stack_bytes) must run out long before this does: a frame was
      // measured at up to 1.33 native bytes per budget byte, and each nested
      // service call adds host frames on top.
      constexpr std::uint64_t nativeStackBytes     = std::uint64_t(256) << 20;
      constexpr std::uint64_t nativeBytesPerBudget = 16;

      wt::engine_options engineOptions()
      {
         wt::engine_options o;
         // Mirrors NativeVMOptions; psizam's validator has the final word.
         o.features = wt::feature::simd | wt::feature::relaxed_simd | wt::feature::bulk_memory |
                      wt::feature::sign_extension | wt::feature::saturating_float_to_int |
                      wt::feature::reference_types | wt::feature::multi_value |
                      wt::feature::threads;
         o.fp                 = wt::float_profile::performance;
         o.native_stack       = nativeStackBytes;
         o.epoch_interruption = true;
         return o;
      }

      wt::runtime<ExecutionContextImpl>& vmRuntime()
      {
         static wt::runtime<ExecutionContextImpl> runtime{engineOptions()};
         return runtime;
      }

      // psizam reports the reason separately from the kind of error.
      template <typename F>
      decltype(auto) withDetail(F f)
      {
         try
         {
            return f();
         }
         catch (const psizam::exception& e)
         {
            throw std::runtime_error(std::string(e.what()) + ": " + e.detail());
         }
      }
   }  // namespace

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

   // Compiled modules, most recently used last. A wasmtime module is shared:
   // any number of transactions run instances of it at once, so entries are
   // copied out rather than checked out.
   struct WasmCacheImpl
   {
      using Key = std::pair<Checksum256, VMOptions>;
      struct Entry
      {
         Key        key;
         wt::module module;
      };
      std::mutex                                   mutex;
      std::uint32_t                                cacheSize;
      std::list<Entry>                             entries;
      std::map<Key, std::list<Entry>::iterator>    index;

      explicit WasmCacheImpl(std::uint32_t cacheSize) : cacheSize{cacheSize} {}

      std::optional<wt::module> get(const Checksum256& hash, const VMOptions& vmOptions)
      {
         std::lock_guard lock{mutex};
         auto            it = index.find(Key{hash, vmOptions});
         if (it == index.end())
            return std::nullopt;
         entries.splice(entries.end(), entries, it->second);
         return it->second->module;
      }

      void add(const Checksum256& hash, const VMOptions& vmOptions, const wt::module& module)
      {
         std::lock_guard lock{mutex};
         Key             key{hash, vmOptions};
         if (index.count(key))
            return;
         entries.push_back(Entry{key, module});
         index[key] = std::prev(entries.end());
         while (entries.size() > cacheSize)
         {
            index.erase(entries.front().key);
            entries.pop_front();
         }
      }
   };

   WasmCache::WasmCache(uint32_t cacheSize, const std::filesystem::path&)
       : impl{std::make_shared<WasmCacheImpl>(cacheSize)}
   {
   }
   WasmCache::WasmCache(const WasmCache& src) : impl{src.impl} {}
   WasmCache::WasmCache(WasmCache&& src) : impl{std::move(src.impl)} {}
   WasmCache::~WasmCache() {}

   // Nothing to do ahead of time: Cranelift compiles a service in tens of
   // milliseconds, at its first use.
   void WasmCache::compileAhead(const Checksum256&, std::span<const char>, const VMOptions&) {}

   // wasmtime owns its code and memory mappings.
   std::vector<std::span<const char>> WasmCache::span() const
   {
      return {};
   }

   // Linear memory belongs to each wasmtime instance. The pool of these still
   // bounds how many services run at once.
   struct ExecutionMemoryImpl
   {
   };
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
      return {};
   }

   struct ExecutionContextImpl : NativeFunctions
   {
      VMOptions                                              vmOptions;
      std::optional<wt::module>                              module;
      std::optional<wt::instance<ExecutionContextImpl>>      instance;
      // Guards the interrupter, which another thread fires on timeout.
      std::mutex                                             interruptMutex;
      std::optional<wt::interrupter>                         interrupter;
      std::atomic<bool>                                      timedOut    = false;
      bool                                                   initialized = false;

      ExecutionContextImpl(TransactionContext& transactionContext,
                           const VMOptions&    vmOptions,
                           ExecutionMemory&,
                           AccountNumber       service)
          : NativeFunctions{transactionContext.blockContext.db, transactionContext,
                            transactionContext.dbMode},
            vmOptions{vmOptions}
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
         check(std::uint64_t(vmOptions.max_stack_bytes) * nativeBytesPerBudget <= nativeStackBytes,
               "max_stack_bytes is larger than the wasmtime engine's native stack allows");

         auto& cache = *transactionContext.blockContext.systemContext.wasmCache.impl;
         module      = cache.get(code.codeHash, vmOptions);
         if (!module)
         {
            // Admission is psizam's: the same checks, in the same order, as
            // the psizam engines apply before they compile.
            NativeVMOptions policy{vmOptions};
            auto            costs = withDetail(
                [&]
                {
                   validateNativeWasm(c->code, policy);
                   return wt::validate_and_cost(c->code, policy);
                });
            module = vmRuntime().compile_metered(c->code, costs);
            cache.add(code.codeHash, vmOptions, *module);
         }
      }

      std::pair<CodeRow, DbId> getCode(AccountNumber service)
      {
         if (dbMode.isSubjective)
         {
            // Check subjective first, then objective
            auto ca = database.kvGet<CodeRow>(DbId::nativeSubjective, codeKey(service));
            if (ca.has_value() && ca->codeHash != Checksum256{})
            {
               ca->flags &= CodeRow::localServiceFlags;
               ca->flags |= ExecutionContext::isLocal;
               return {std::move(*ca), DbId::nativeSubjective};
            }
         }
         // Use objective service
         auto ca = database.kvGet<CodeRow>(DbId::native, codeKey(service));
         check(ca.has_value(), "unknown service account: " + service.str());
         check(ca->codeHash != Checksum256{}, "service account has no code");
         ca->flags &= CodeRow::chainServiceFlags;
         return {std::move(*ca), DbId::native};
      }

      // Instantiates the service and runs its initialization with `stack`
      // bytes available: data and element segments, the module's start
      // function, then the service's `start` export.
      void init(std::uint32_t stack)
      {
         wt::instance_limits limits{
             .max_memory_bytes   = std::uint64_t(vmOptions.max_pages) * 65536,
             .max_table_elements = vmOptions.max_table_elements,
         };
         instance.emplace(vmRuntime(), *module, *this, limits);
         {
            std::lock_guard lock{interruptMutex};
            interrupter.emplace(instance->make_interrupter());
            if (timedOut)
               interrupter->fire();
         }
         instance->set_stack_remaining(stack);
         instance->run_start();
         instance->call_discarding_results("start", currentActContext->action.service.value);
         initialized = true;
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
         // A service can be re-entered while one of its calls is suspended in
         // a host function. That outer call's remaining stack is restored when
         // this one finishes, however it finishes.
         const bool          wasInitialized = initialized;
         const std::uint32_t previousStack  = wasInitialized ? instance->stack_remaining() : 0;
         auto                restore        = psio::finally{[&]
                                                            {
                                                               currentActContext = prev;
                                                               if (wasInitialized)
                                                                  instance->set_stack_remaining(
                                                                      previousStack);
                                                            }};
         RecordActionTime timer{actionContext};
         try
         {
            const auto stack = actionContext.transactionContext.remainingStack;
            if (!initialized)
               init(stack);
            else
               instance->set_stack_remaining(stack);
            f();
         }
         catch (const accounting::Cancelled&)
         {
            // A synchronous storage check can observe expiry before the
            // watchdog thread has delivered asyncTimeout to this VM.
            throw TimeoutException{};
         }
         catch (...)
         {
            if (timedOut)
               throw TimeoutException{};
            throw;
         }
      }

      void onTransferControl(std::uint64_t callerFlags)
      {
         transactionContext.importedHandles.clear();
         std::swap(transactionContext.exportedHandles, transactionContext.importedHandles);
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
      static std::once_flag once;
      std::call_once(
          once,
          []
          {
             auto& rt = vmRuntime();
             rt.add<&ExecutionContextImpl::getResult>("env", "getResult");
             rt.add<&ExecutionContextImpl::getKey>("env", "getKey");
             rt.add<&ExecutionContextImpl::writeConsole>("env", "writeConsole");
             rt.add<&ExecutionContextImpl::abortMessage>("env", "abortMessage");
             rt.add<&ExecutionContextImpl::clockTimeGet>("env", "clockTimeGet");
             rt.add<&ExecutionContextImpl::getRandom>("env", "getRandom");
             rt.add<&ExecutionContextImpl::setMaxCpuTime>("env", "setMaxCpuTime");
             rt.add<&ExecutionContextImpl::getCurrentAction>("env", "getCurrentAction");
             rt.add<&ExecutionContextImpl::call>("env", "call");
             rt.add<&ExecutionContextImpl::setRetval>("env", "setRetval");
             rt.add<&ExecutionContextImpl::kvOpen>("env", "kvOpen");
             rt.add<&ExecutionContextImpl::kvOpenAt>("env", "kvOpenAt");
             rt.add<&ExecutionContextImpl::kvClose>("env", "kvClose");
             rt.add<&ExecutionContextImpl::exportHandles>("env", "exportHandles");
             rt.add<&ExecutionContextImpl::importHandles>("env", "importHandles");
             rt.add<&ExecutionContextImpl::kvPut>("env", "kvPut");
             rt.add<&ExecutionContextImpl::kvRemove>("env", "kvRemove");
             rt.add<&ExecutionContextImpl::kvGet>("env", "kvGet");
             rt.add<&ExecutionContextImpl::kvGreaterEqual>("env", "kvGreaterEqual");
             rt.add<&ExecutionContextImpl::kvLessThan>("env", "kvLessThan");
             rt.add<&ExecutionContextImpl::kvMax>("env", "kvMax");
             rt.add<&ExecutionContextImpl::checkoutSubjective>("env", "checkoutSubjective");
             rt.add<&ExecutionContextImpl::commitSubjective>("env", "commitSubjective");
             rt.add<&ExecutionContextImpl::abortSubjective>("env", "abortSubjective");
             rt.add<&ExecutionContextImpl::socketOpen>("env", "socketOpen");
             rt.add<&ExecutionContextImpl::socketSend>("env", "socketSend");
             rt.add<&ExecutionContextImpl::socketSetFlags>("env", "socketSetFlags");
             rt.add<&ExecutionContextImpl::readFile>("env", "readFile");
             rt.link();
          });
   }

   std::uint32_t ExecutionContext::remainingStack() const
   {
      return impl->instance ? impl->instance->stack_remaining()
                            : impl->transactionContext.remainingStack;
   }

   void ExecutionContext::execProcessTransaction(ActionContext& actionContext)
   {
      impl->exec(actionContext,
                 [&] { impl->instance->call_discarding_results("processTransaction"); });
   }

   void ExecutionContext::execCalled(uint64_t callerFlags, ActionContext& actionContext)
   {
      impl->onTransferControl(callerFlags);
      auto cleanup = psio::finally{[&] { impl->onTransferControl(callerFlags); }};

      if ((callerFlags & (callerSudo | isLocal)) == callerSudo)
      {
         check((impl->code.flags & (isLocal | CodeRow::isReplacement)) != isLocal,
               "on-chain service cannot sudo when calling a node-local service");
      }

      impl->exec(actionContext,
                 [&]
                 {
                    impl->instance->call_discarding_results(
                        "called", actionContext.action.service.value,
                        actionContext.action.sender.value);
                 });
   }

   void ExecutionContext::execServe(ActionContext& actionContext)
   {
      impl->exec(actionContext, [&] { impl->instance->call_discarding_results("serve"); });
   }

   void ExecutionContext::exec(ActionContext& actionContext, std::string_view fn)
   {
      impl->exec(actionContext, [&] { impl->instance->call_discarding_results(fn); });
   }

   void ExecutionContext::asyncTimeout()
   {
      impl->timedOut = true;
      std::lock_guard lock{impl->interruptMutex};
      if (impl->interrupter)
         impl->interrupter->fire();
   }
}  // namespace psibase
