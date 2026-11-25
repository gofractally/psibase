// The wasmtime execution engine (see VmEngine.hpp).
//
// wasmtime (Cranelift) executes; psizam decides what may execute. Every
// service still passes validateNativeWasm and psizam's parser under
// NativeVMOptions, so limits and enabled proposals are the chain policy. That
// parse also yields psizam's per-function stack costs, which wasmtime's
// compiler enforces so the stack-overflow point is the same as on psizam's
// engines. The module itself is compiled as deployed: nothing rewrites it.
//
// ExecutionContext.cpp is the psizam counterpart of this file.

#include <psibase/NativeFunctions.hpp>

#include <atomic>
#include <list>
#include <map>
#include <mutex>
#include <optional>
#include <psibase/ActionContext.hpp>
#include <psibase/NativeAotCache.hpp>
#include <psibase/PsizamPolicy.hpp>
#include <psibase/VmEngine.hpp>
#include <psibase/crypto.hpp>
#include <psibase/db.hpp>
#include <psibase/finally.hpp>
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

namespace psibase::vm_wasmtime
{
   struct ExecutionContextImpl;

   namespace
   {
      // Native stack for wasm, per executing thread. The byte budget
      // (max_stack_bytes) must run out long before this does: a frame was
      // measured at up to 1.72 native bytes per budget byte (psizam's
      // "byte budget ends recursion before the native stack can" test), and
      // each nested service call adds host frames on top.
      constexpr std::uint64_t nativeStackBytes     = std::uint64_t(256) << 20;
      constexpr std::uint64_t nativeBytesPerBudget = 16;

      // Instance slots kept by each pooled engine. A transfer runs about
      // sixteen services, each a new instance, and a slot stays warm for the
      // service that last used it. Zero turns the pool off; anything the pool
      // cannot serve runs on the engine without one.
      std::uint32_t pooledInstances()
      {
         static const std::uint32_t count = []() -> std::uint32_t
         {
            if (const char* text = std::getenv("PSIBASE_WASMTIME_POOL"))
               return static_cast<std::uint32_t>(std::strtoul(text, nullptr, 10));
            return 256;
         }();
         return count;
      }

      wt::engine_options engineOptions(psizam::float_profile profile, bool pooled = false)
      {
         wt::engine_options o;
         // Mirrors NativeVMOptions; psizam's validator has the final word.
         o.features = wt::feature::simd | wt::feature::relaxed_simd | wt::feature::bulk_memory |
                      wt::feature::sign_extension | wt::feature::saturating_float_to_int |
                      wt::feature::reference_types | wt::feature::multi_value |
                      wt::feature::threads;
         o.fp                 = profile == psizam::float_profile::strict
                                    ? wt::float_profile::strict
                                    : wt::float_profile::performance;
         o.native_stack       = nativeStackBytes;
         o.epoch_interruption = true;
         if (pooled)
         {
            o.pool_instances      = pooledInstances();
            o.pool_table_elements = 65536;
         }
         return o;
      }

      // One wasmtime engine per float profile: the profile a service runs
      // under comes from the version its code was deployed with.
      // Modules are compiled and instantiated here: instances come from the
      // engine's pool of slots.
      wt::runtime<ExecutionContextImpl> pooledRuntime(psizam::float_profile profile)
      {
         try
         {
            return wt::runtime<ExecutionContextImpl>{engineOptions(profile, true)};
         }
         catch (const wt::error&)
         {
            // The pool reserves address space for every slot up front. Where
            // the system refuses that, instances are created one at a time.
            return wt::runtime<ExecutionContextImpl>{engineOptions(profile)};
         }
      }

      wt::runtime<ExecutionContextImpl>& vmRuntime(psizam::float_profile profile)
      {
         static wt::runtime<ExecutionContextImpl> strict =
             pooledRuntime(psizam::float_profile::strict);
         static wt::runtime<ExecutionContextImpl> performance =
             pooledRuntime(psizam::float_profile::performance);
         return profile == psizam::float_profile::strict ? strict : performance;
      }

      // The same engine without a pool, for an instance the pool cannot
      // provide. It runs the same compiled code.
      wt::runtime<ExecutionContextImpl>& unpooledRuntime(psizam::float_profile profile)
      {
         static wt::runtime<ExecutionContextImpl> strict{
             engineOptions(psizam::float_profile::strict)};
         static wt::runtime<ExecutionContextImpl> performance{
             engineOptions(psizam::float_profile::performance)};
         return profile == psizam::float_profile::strict ? strict : performance;
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

   // Compiled modules, most recently used last. A wasmtime module is shared:
   // any number of transactions run instances of it at once, so entries are
   // copied out rather than checked out.
   struct WasmCacheImpl : vm::Cache
   {
      // Code under different versions compiles differently from the same bytes.
      using Key = std::tuple<Checksum256, VMOptions, std::uint8_t>;
      struct Entry
      {
         Key        key;
         wt::module module;
         // The module loaded into the engine without an instance pool, once
         // an instance of it could not be taken from the pool.
         std::optional<wt::module> unpooled;
      };
      std::mutex                                   mutex;
      std::uint32_t                                cacheSize;
      std::list<Entry>                             entries;
      std::map<Key, std::list<Entry>::iterator>    index;
      // Compiled modules kept between runs. The directory is private to the
      // user: wasmtime executes what it loads from here without checking it.
      std::shared_ptr<NativeAotCache>              artifacts;

      WasmCacheImpl(std::uint32_t cacheSize, const std::filesystem::path& path)
          : cacheSize{cacheSize},
            artifacts(path.empty() ? nativeAotCacheFromEnvironment()
                                   : std::make_shared<NativeAotCache>(path))
      {
      }

      // Everything that determines the compiled code: the service, the chain
      // limits it was admitted and metered under, the engine's proposal set
      // and float profile, and the wasmtime build.
      static NativeAotCache::Key artifactKey(const Checksum256&    hash,
                                             const VMOptions&      vmOptions,
                                             std::uint8_t          vmVersion,
                                             psizam::float_profile profile)
      {
         auto options = engineOptions(profile);
         auto digest  = sha256(std::tuple{
             std::string("psibase-wasmtime-artifact-v3"), hash, vmOptions, vmVersion,
             options.features, std::uint32_t(options.fp), std::string(wt::build_identity())});
         NativeAotCache::Key key;
         std::copy(digest.begin(), digest.end(), key.begin());
         return key;
      }

      std::optional<wt::module> get(const Checksum256& hash,
                                    const VMOptions&   vmOptions,
                                    std::uint8_t       vmVersion)
      {
         std::lock_guard lock{mutex};
         auto            it = index.find(Key{hash, vmOptions, vmVersion});
         if (it == index.end())
            return std::nullopt;
         entries.splice(entries.end(), entries, it->second);
         return it->second->module;
      }

      // The module as the engine without an instance pool holds it.
      wt::module unpooled(const Checksum256&    hash,
                          const VMOptions&      vmOptions,
                          std::uint8_t          vmVersion,
                          psizam::float_profile profile,
                          const wt::module&     module)
      {
         const Key key{hash, vmOptions, vmVersion};
         {
            std::lock_guard lock{mutex};
            auto            it = index.find(key);
            if (it != index.end() && it->second->unpooled)
               return *it->second->unpooled;
         }
         const auto artifact = module.serialize();
         auto       loaded   = unpooledRuntime(profile).load(artifact);
         std::lock_guard lock{mutex};
         auto            it = index.find(key);
         if (it != index.end() && !it->second->unpooled)
            it->second->unpooled = loaded;
         return loaded;
      }

      // wasmtime owns its code and memory mappings.
      std::vector<std::span<const char>> span() const override { return {}; }

      // Nothing to do ahead of time: Cranelift compiles a service in tens of
      // milliseconds, at its first use, and the result is kept on disk.
      void compileAhead(const Checksum256&,
                        std::span<const char>,
                        const VMOptions&,
                        std::uint8_t) override
      {
      }

      void add(const Checksum256& hash,
               const VMOptions&   vmOptions,
               std::uint8_t       vmVersion,
               const wt::module&  module)
      {
         std::lock_guard lock{mutex};
         Key             key{hash, vmOptions, vmVersion};
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

   // Linear memory belongs to each wasmtime instance. The pool of memory slots
   // still bounds how many services run at once.
   struct ExecutionMemoryImpl : vm::Memory
   {
      std::span<const char> span() const override { return {}; }
   };

   struct ExecutionContextImpl : NativeFunctions, vm::Context
   {
      VMOptions                                              vmOptions;
      WasmCacheImpl&                                         cache;
      psizam::float_profile floatProfile = psizam::float_profile::strict;
      std::optional<wt::module>                              module;
      // Reading the stack counter goes through the store, which is not const.
      mutable std::optional<wt::instance<ExecutionContextImpl>> instance;
      // Guards the interrupter, which another thread fires on timeout.
      std::mutex                                             interruptMutex;
      std::optional<wt::interrupter>                         interrupter;
      std::atomic<bool>                                      timedOut    = false;
      bool                                                   initialized = false;

      ExecutionContextImpl(TransactionContext& transactionContext,
                           const VMOptions&    vmOptions,
                           WasmCacheImpl&      cache,
                           AccountNumber       service)
          : NativeFunctions{transactionContext.blockContext.db, transactionContext,
                            transactionContext.dbMode},
            vmOptions{vmOptions},
            cache{cache}
      {
         database.checkoutSubjective();
         psibase::finally _{[&] { database.abortSubjective(); }};
         auto [ca, db] = getCode(service);

         code   = std::move(ca);
         // The code itself is read only to compile it. It is hundreds of
         // kilobytes, and a context is created for every service a
         // transaction touches; reading and unpacking it each time, to then
         // take the compiled module from the cache, was a fifth of the time
         // a transfer spent in the chain. The record must still exist, so
         // that a node with the module cached and one without agree.
         const auto codeRecord =
             psio::encode(psio::key{}, codeByHashKey(code.codeHash, code.vmType, code.vmVersion));
         check(database.kvContains(db, codeRecord), "service code record is missing");
         std::optional<CodeByHashRow> c;
         auto                         loadCode = [&]
         {
            if (!c)
            {
               c = database.kvGet<CodeByHashRow>(
                   db, codeByHashKey(code.codeHash, code.vmType, code.vmVersion));
               check(c.has_value(), "service code record is missing");
            }
         };
         check(code.vmType == 0, "vmType is not 0");
         // The version a service was deployed under selects the execution
         // policy its code keeps until it is next deployed.
         auto profile = nativeFloatProfile(code.vmVersion);
         check(profile.has_value(), "vmVersion is not supported");
         floatProfile = *profile;
         if (transactionContext.dbMode.verifyOnly)
         {
            check(code.flags & CodeRow::isVerify,
                  "service account " + service.str() + " cannot be used in verify mode");
            // Ignore all other flags
            code.flags &= CodeRow::isVerify;
         }
         check(std::uint64_t(vmOptions.max_stack_bytes) * nativeBytesPerBudget <= nativeStackBytes,
               "max_stack_bytes is larger than the wasmtime engine's native stack allows");

         module      = cache.get(code.codeHash, vmOptions, code.vmVersion);
         // Loading or compiling the code is not billed to the transaction.
         std::optional<TransactionContext::BillingPause> unbilled;
         if (!module)
            unbilled.emplace(transactionContext);
         if (!module)
         {
            // An artifact stored under this key was admitted and compiled from
            // this exact service under these exact limits by this build.
            const auto key = WasmCacheImpl::artifactKey(code.codeHash, vmOptions, code.vmVersion,
                                                        floatProfile);
            if (cache.artifacts)
               if (auto stored = cache.artifacts->load(key))
                  try
                  {
                     module = vmRuntime(floatProfile).load(std::span(
                         reinterpret_cast<const std::uint8_t*>(stored->data()), stored->size()));
                  }
                  catch (const std::exception&)
                  {
                     // Unreadable or from an incompatible build: compile again.
                  }
         }
         if (!module)
         {
            // Admission is psizam's: the same checks, in the same order, as
            // the psizam engines apply before they compile.
            loadCode();
            NativeVMOptions policy{vmOptions, {}, code.vmVersion};
            auto            costs = withDetail(
                [&]
                {
                   validateNativeWasm(c->code, policy);
                   return wt::validate_and_cost(c->code, policy);
                });
            module = vmRuntime(floatProfile).compile_metered(c->code, costs);
            if (cache.artifacts)
            {
               auto artifact = module->serialize();
               cache.artifacts->store(
                   WasmCacheImpl::artifactKey(code.codeHash, vmOptions, code.vmVersion,
                                              floatProfile),
                   std::span(reinterpret_cast<const char*>(artifact.data()), artifact.size()));
            }
         }
         if (!cache.get(code.codeHash, vmOptions, code.vmVersion))
            cache.add(code.codeHash, vmOptions, code.vmVersion, *module);
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
         try
         {
            instance.emplace(vmRuntime(floatProfile), *module, *this, limits);
         }
         catch (const wt::instantiation_error&)
         {

            // No slot is free, or this module does not fit one. Nothing has
            // run; the engine without a pool creates the same instance, or
            // reports why none can be created.
            module = cache.unpooled(code.codeHash, vmOptions, code.vmVersion, floatProfile,
                                    *module);
            instance.emplace(unpooledRuntime(floatProfile), *module, *this, limits);
         }
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

      // The time an action took, for its trace: elapsed time on the monotonic
      // clock, read without a system call. It is the clock the transaction's
      // limit and its bill use (RunClock).
      struct RecordActionTime
      {
         explicit RecordActionTime(ActionContext& actionContext) : actionContext(actionContext) {}
         ~RecordActionTime()
         {
            actionContext.actionTrace.totalTime = std::chrono::steady_clock::now() - start;
         }
         ActionContext&                        actionContext;
         std::chrono::steady_clock::time_point start = std::chrono::steady_clock::now();
      };

      template <typename F>
      void run(ActionContext& actionContext, F f)
      {
         auto prev         = currentActContext;
         currentActContext = &actionContext;
         // A service can be re-entered while one of its calls is suspended in
         // a host function. That outer call's remaining stack is restored when
         // this one finishes, however it finishes.
         const bool          wasInitialized = initialized;
         const std::uint32_t previousStack  = wasInitialized ? instance->stack_remaining() : 0;
         auto                restore        = psibase::finally{[&]
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

      void rebind(ExecutionContext* self) override { currentExecContext = self; }
      std::uint32_t remainingStack() const override;
      void          execProcessTransaction(ActionContext& actionContext) override;
      void          execCalled(uint64_t callerFlags, ActionContext& actionContext) override;
      void          execServe(ActionContext& actionContext) override;
      void          exec(ActionContext& actionContext, std::string_view fn) override;
      void          asyncTimeout() override;
   };  // ExecutionContextImpl

   static void registerHostFunctions()
   {
      static std::once_flag once;
      std::call_once(
          once,
          []
          {
             // Both engines of a profile import the same host functions.
             const auto profiles = {psizam::float_profile::strict,
                                    psizam::float_profile::performance};
             std::vector<wt::runtime<ExecutionContextImpl>*> runtimes;
             for (auto profile : profiles)
             {
                runtimes.push_back(&vmRuntime(profile));
                runtimes.push_back(&unpooledRuntime(profile));
             }
             for (auto* runtime : runtimes)
             {
                auto& rt = *runtime;
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
             }
          });
   }

   std::uint32_t ExecutionContextImpl::remainingStack() const
   {
      return instance ? instance->stack_remaining()
                            : transactionContext.remainingStack;
   }

   void ExecutionContextImpl::execProcessTransaction(ActionContext& actionContext)
   {
      run(actionContext,
                 [&] { instance->call_discarding_results("processTransaction"); });
   }

   void ExecutionContextImpl::execCalled(uint64_t callerFlags, ActionContext& actionContext)
   {
      onTransferControl(callerFlags);
      auto cleanup = psibase::finally{[&] { onTransferControl(callerFlags); }};

      if ((callerFlags & (ExecutionContext::callerSudo | ExecutionContext::isLocal)) ==
          ExecutionContext::callerSudo)
      {
         check((code.flags & (ExecutionContext::isLocal | CodeRow::isReplacement)) !=
                   ExecutionContext::isLocal,
               "on-chain service cannot sudo when calling a node-local service");
      }

      run(actionContext,
                 [&]
                 {
                    instance->call_discarding_results(
                        "called", actionContext.action.service.value,
                        actionContext.action.sender.value);
                 });
   }

   void ExecutionContextImpl::execServe(ActionContext& actionContext)
   {
      run(actionContext, [&] { instance->call_discarding_results("serve"); });
   }

   void ExecutionContextImpl::exec(ActionContext& actionContext, std::string_view fn)
   {
      run(actionContext, [&] { instance->call_discarding_results(fn); });
   }

   void ExecutionContextImpl::asyncTimeout()
   {
      timedOut = true;
      std::lock_guard lock{interruptMutex};
      if (interrupter)
         interrupter->fire();
   }

   const vm::Engine& engine()
   {
      static const vm::Engine result{
          "wasmtime",
          &registerHostFunctions,
          +[](std::uint32_t cacheSize, const std::filesystem::path& path) -> std::shared_ptr<vm::Cache>
          { return std::make_shared<WasmCacheImpl>(cacheSize, path); },
          +[]() -> std::unique_ptr<vm::Memory> { return std::make_unique<ExecutionMemoryImpl>(); },
          +[](TransactionContext& transactionContext, const VMOptions& vmOptions, vm::Memory&,
              vm::Cache& cache, AccountNumber service) -> std::unique_ptr<vm::Context>
          {
             return std::make_unique<ExecutionContextImpl>(
                 transactionContext, vmOptions, static_cast<WasmCacheImpl&>(cache), service);
          }};
      return result;
   }
}  // namespace psibase::vm_wasmtime
