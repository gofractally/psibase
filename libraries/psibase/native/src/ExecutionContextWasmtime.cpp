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
#include <cstdio>
#include <list>
#include <map>
#include <mutex>
#include <optional>
#include <psibase/ActionContext.hpp>
#include <psibase/NativeAotCache.hpp>
#include <psibase/NativeHostFunctions.hpp>
#include <psibase/PsizamPolicy.hpp>
#include <psibase/VmEngine.hpp>
#include <psibase/WasmtimeHost.hpp>
#include <psibase/crypto.hpp>
#include <psibase/db.hpp>
#include <psibase/finally.hpp>
#include <psibase/log.hpp>
#include <psizam/wasmtime_admission.hpp>
#include <psizam/wasmtime_backend.hpp>

namespace wt = psizam::wasmtime;

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
      constexpr std::uint64_t nativeStackBytes     = serviceNativeStackBytes;
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

      // The innermost frames kept of a failed call's stack. A stack overflow is
      // thousands of frames deep and every one kept is looked up and logged.
      constexpr std::uint32_t backtraceFrames = 128;

      // `debug` is vm::serviceDebugging() as the WasmCache found it. It only
      // adds what a developer can observe from outside the chain: the code it
      // compiles differs, what that code computes does not.
      wt::engine_options engineOptions(psizam::float_profile profile,
                                       bool                  debug,
                                       bool                  pooled = false)
      {
         wt::engine_options o;
         // Mirrors NativeVMOptions; psizam's validator has the final word.
         o.features           = wasmFeatures;
         o.fp                 = profile == psizam::float_profile::strict
                                    ? wt::float_profile::strict
                                    : wt::float_profile::performance;
         o.native_stack       = nativeStackBytes;
         o.epoch_interruption = true;
         if (debug)
         {
            o.backtrace            = true;
            o.backtrace_details    = true;
            o.backtrace_max_frames = backtraceFrames;
            o.debug_info           = true;
         }
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
      wt::runtime<ExecutionContextImpl> pooledRuntime(psizam::float_profile profile, bool debug)
      {
         try
         {
            return wt::runtime<ExecutionContextImpl>{engineOptions(profile, debug, true)};
         }
         catch (const wt::error&)
         {
            // The pool reserves address space for every slot up front. Where
            // the system refuses that, instances are created one at a time.
            return wt::runtime<ExecutionContextImpl>{engineOptions(profile, debug)};
         }
      }

      // The engines of one debugging mode. Debugging is a property of an
      // engine, so services being debugged run on engines of their own.
      struct Runtimes
      {
         wt::runtime<ExecutionContextImpl> pooledStrict;
         wt::runtime<ExecutionContextImpl> pooledPerformance;
         // The same engines without a pool, for an instance the pool cannot
         // provide. They run the same compiled code.
         wt::runtime<ExecutionContextImpl> unpooledStrict;
         wt::runtime<ExecutionContextImpl> unpooledPerformance;

         // Links the host functions into every engine.
         explicit Runtimes(bool debug);

         wt::runtime<ExecutionContextImpl>& pooled(psizam::float_profile profile)
         {
            return profile == psizam::float_profile::strict ? pooledStrict : pooledPerformance;
         }
         wt::runtime<ExecutionContextImpl>& unpooled(psizam::float_profile profile)
         {
            return profile == psizam::float_profile::strict ? unpooledStrict : unpooledPerformance;
         }
      };

      // Made at first use, so a node that never debugs has no debugging engines.
      Runtimes& runtimes(bool debug);
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
         // The compiled module. It carries where its entry points are: the
         // engine finds them, and checks their signatures, when a module is
         // compiled or loaded.
         wt::module module;
         // Set if the module belongs to the engine without an instance pool
         // because it does not fit a pool slot at all (see Compiled).
         bool       poolless = false;
         // The module loaded into the engine without an instance pool, once
         // an instance of it could not be taken from the pool.
         std::optional<wt::module> unpooled;
      };
      // A compiled module and the engine it belongs to. wasmtime checks a
      // module against the instance pool's slot size when the pooled engine
      // compiles or loads it, so a module that is too large for a slot (its
      // table, or the instance itself) cannot exist there. Such a module is
      // compiled on the engine without a pool and always instantiated there:
      // the pool's slot size is this node's tuning and never decides whether
      // a service can run (gofractally/psibase#2272).
      struct Compiled
      {
         wt::module module;
         bool       poolless = false;
      };
      static bool exceedsPool(const std::exception& e)
      {
         return std::string_view(e.what()).find("pooling allocator") != std::string_view::npos;
      }
      mutable std::mutex                           mutex;
      std::uint32_t                                cacheSize;
      std::list<Entry>                             entries;
      std::map<Key, std::list<Entry>::iterator>    index;
      // Code compileAhead could not compile (vm::Cache::refused): recorded
      // there, removed where a module of it is added.
      vm::RefusedCode<Key>                         refusedCode;
      // Compiled modules kept between runs. wasmtime executes what it loads
      // from here as it is; the cache returns only what it has verified
      // (NativeAotCache.hpp).
      std::shared_ptr<NativeAotCache>              artifacts;
      std::atomic<std::uint64_t>                   compiled{0};
      std::atomic<std::uint64_t>                   loaded{0};
      // Of those, the modules that went to the engine without a pool.
      std::atomic<std::uint64_t>                   compiledPoolless{0};
      std::atomic<std::uint64_t>                   loadedPoolless{0};
      // Compiles given up through their handle (compileCancellable).
      std::atomic<std::uint64_t>                   compilesAbandoned{0};
      // Whether the services of this cache run with debugging support. Fixed
      // for the cache's lifetime: its modules belong to that mode's engines.
      const bool                                   debug = vm::serviceDebugging();

      WasmCacheImpl(std::uint32_t cacheSize, std::shared_ptr<NativeAotCache> store)
          : cacheSize{cacheSize},
            artifacts(store ? std::move(store) : nativeAotCacheFromEnvironment())
      {
      }

      // Everything that determines the compiled code: the service, the chain
      // limits it was admitted and metered under, the engine's proposal set
      // and float profile, the debugging options that change what is
      // compiled, and the wasmtime build.
      NativeAotCache::Key artifactKey(const Checksum256&    hash,
                                      const VMOptions&      vmOptions,
                                      std::uint8_t          vmVersion,
                                      psizam::float_profile profile) const
      {
         auto options = engineOptions(profile, debug);
         auto digest  = sha256(std::tuple{
             std::string("psibase-wasmtime-artifact-v5"), hash, vmOptions, vmVersion,
             options.features, std::uint32_t(options.fp),
             // Service debugging: the two debugging options an artifact is
             // tied to. A runtime only loads artifacts made with the same.
             options.backtrace_details, options.debug_info,
             std::string(wt::build_identity())});
         NativeAotCache::Key key;
         std::copy(digest.begin(), digest.end(), key.begin());
         return key;
      }

      // The module for stored code that is not in memory: from the artifact
      // store, or compiled now and stored. `code()` is called, for the wasm,
      // only if it has to be compiled. Throws the admission error, or the
      // compiler's.
      //
      // Called on the thread that needs the module, with no lock held: two
      // threads that need the same new module both compile it and store the
      // same artifact, and different modules compile side by side.
      //
      // With a `cancel`, a compile from wasm that is abandoned through it
      // throws wt::compile_cancelled: nothing was compiled, counted or
      // stored.
      template <typename Code>
      Compiled obtain(const Checksum256&        hash,
                      const VMOptions&          vmOptions,
                      std::uint8_t              vmVersion,
                      psizam::float_profile     profile,
                      Code&&                    code,
                      const wt::compile_cancel* cancel = nullptr)
      {
         // An artifact stored under this key was admitted and compiled from
         // this exact service under these exact limits by this build, and
         // the store returns it only if it is what was stored.
         const auto key = artifactKey(hash, vmOptions, vmVersion, profile);
         if (artifacts)
            if (auto stored = artifacts->load(key))
               try
               {
                  const std::span artifact(reinterpret_cast<const std::uint8_t*>(stored->data()),
                                           stored->size());
                  Compiled        module = [&]
                  {
                     try
                     {
                        return Compiled{runtimes(debug).pooled(profile).load(artifact)};
                     }
                     catch (const std::exception& e)
                     {
                        if (!exceedsPool(e))
                           throw;
                        return Compiled{runtimes(debug).unpooled(profile).load(artifact), true};
                     }
                  }();
                  ++loaded;
                  if (module.poolless)
                     ++loadedPoolless;
                  PSIBASE_LOG(loggers::generic::get(), debug)
                      << "Service code " << loggers::to_string(hash) << " (vmVersion "
                      << unsigned(vmVersion) << ") loaded from the compiled-module cache";
                  return module;
               }
               catch (const std::exception&)
               {
                  // Intact, but this engine will not take it: compile again.
               }
         // Admission is psizam's: the same checks, in the same order, as
         // the psizam engines apply before they compile.
         const std::span<const std::uint8_t> wasm     = code();
         // `code` may have waited for a compile of this module on another
         // thread (TransactionContext::codeNotCompiled).
         if (auto ready = get(hash, vmOptions, vmVersion))
            return *ready;
         if (compileHook)
            compileHook(hash);
         const auto                          admitted =
             // Chain code reached here through the chain's own rule
             // (TransactionContext::admitCode); what this must also let
             // through is the code of node-local services.
             admitNativeWasm(wasm, vmOptions, vmVersion, true);
         Compiled result = [&]
         {
            try
            {
               return Compiled{
                   runtimes(debug).pooled(profile).compile_metered(wasm, admitted.costs, cancel)};
            }
            catch (const wt::compile_cancelled&)
            {
               throw;
            }
            catch (const std::exception& e)
            {
               if (!exceedsPool(e))
                  throw;
               return Compiled{
                   runtimes(debug).unpooled(profile).compile_metered(wasm, admitted.costs, cancel),
                   true};
            }
         }();
         auto& module = result.module;
         ++compiled;
         if (result.poolless)
            ++compiledPoolless;
         std::size_t stored = 0;
         if (artifacts)
         {
            auto artifact = module.serialize();
            stored        = artifact.size();
            artifacts->store(
                key, std::span(reinterpret_cast<const char*>(artifact.data()), artifact.size()));
         }
         PSIBASE_LOG(loggers::generic::get(), debug)
             << "Service code " << loggers::to_string(hash) << " (vmVersion " << unsigned(vmVersion)
             << ") compiled: " << wasm.size() << " bytes of wasm, " << stored
             << " bytes of native code";
         return result;
      }

      std::optional<Compiled> get(const Checksum256& hash,
                                  const VMOptions&   vmOptions,
                                  std::uint8_t       vmVersion)
      {
         std::lock_guard lock{mutex};
         auto            it = index.find(Key{hash, vmOptions, vmVersion});
         if (it == index.end())
            return std::nullopt;
         entries.splice(entries.end(), entries, it->second);
         return Compiled{it->second->module, it->second->poolless};
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
         auto       loaded   = runtimes(debug).unpooled(profile).load(artifact);
         std::lock_guard lock{mutex};
         auto            it = index.find(key);
         if (it != index.end() && !it->second->unpooled)
            it->second->unpooled = loaded;
         return loaded;
      }

      // wasmtime owns its code and memory mappings.
      std::vector<std::span<const char>> span() const override { return {}; }

      // Cranelift compiles a service in tens of milliseconds, so there is no
      // queue and no second tier: the code is compiled here, on the thread
      // that stored it, and is in memory and in the artifact store when this
      // returns. The caller has admitted it (TransactionContext::admitCode).
      // If the compiler still refuses it, that is this node's fault, not the
      // transaction's: it is logged, the code stays stored, and whatever
      // executes it first tries again and reports the error.
      void compileAhead(const Checksum256&    hash,
                        std::span<const char> code,
                        const VMOptions&      vmOptions,
                        std::uint8_t          vmVersion) override
      {
         compile(hash, code, vmOptions, vmVersion, nullptr);
      }

      // Cranelift can be stopped: between the functions of a module, between
      // the passes over a function and inside register allocation. What it
      // does not interrupt is short (psizam's wasmtime/README.md).
      struct Cancel : CompileCancel
      {
         wt::compile_cancel handle;
         void               cancel() override { handle.cancel(); }
      };
      std::unique_ptr<CompileCancel> makeCompileCancel() const override
      {
         return std::make_unique<Cancel>();
      }
      CompileEnd compileCancellable(const Checksum256&    hash,
                                    std::span<const char> code,
                                    const VMOptions&      vmOptions,
                                    std::uint8_t          vmVersion,
                                    CompileCancel&        cancel) override
      {
         return compile(hash, code, vmOptions, vmVersion, &static_cast<Cancel&>(cancel).handle);
      }

      CompileEnd compile(const Checksum256&        hash,
                         std::span<const char>     code,
                         const VMOptions&          vmOptions,
                         std::uint8_t              vmVersion,
                         const wt::compile_cancel* cancel)
      {
         try
         {
            auto profile = nativeFloatProfile(vmVersion);
            if (!profile)
            {
               // Nothing here compiles it, now or later.
               std::lock_guard lock{mutex};
               refusedCode.record(Key{hash, vmOptions, vmVersion});
               return CompileEnd::finished;
            }
            if (contains(hash, vmOptions, vmVersion))
               return CompileEnd::finished;
            add(hash, vmOptions, vmVersion,
                obtain(
                    hash, vmOptions, vmVersion, *profile,
                    [&]
                    {
                       return std::span(reinterpret_cast<const std::uint8_t*>(code.data()),
                                        code.size());
                    },
                    cancel));
         }
         catch (const wt::compile_cancelled&)
         {
            // Not a refusal and not a failure: the node stopped waiting.
            // Nothing is recorded, so the code is compiled again when it is
            // next asked for.
            ++compilesAbandoned;
            PSIBASE_LOG(loggers::generic::get(), info)
                << "Service code " << loggers::to_string(hash) << " (vmVersion "
                << unsigned(vmVersion) << "): the compile was abandoned";
            return CompileEnd::abandoned;
         }
         catch (const std::exception& e)
         {
            PSIBASE_LOG(loggers::generic::get(), error)
                << "Service code " << loggers::to_string(hash) << " (vmVersion "
                << unsigned(vmVersion) << ") was not compiled when it was stored: " << e.what()
                << ". It stays stored and is compiled again when it is first executed.";
            // The explicit record a producer's deferral asks for: without
            // it the code would be deferred until its transaction expired.
            std::lock_guard lock{mutex};
            refusedCode.record(Key{hash, vmOptions, vmVersion});
         }
         return CompileEnd::finished;
      }

      bool refused(const Checksum256& hash,
                   const VMOptions&   vmOptions,
                   std::uint8_t       vmVersion) const override
      {
         std::lock_guard lock{mutex};
         return refusedCode.contains(Key{hash, vmOptions, vmVersion});
      }

      bool contains(const Checksum256& hash,
                    const VMOptions&   vmOptions,
                    std::uint8_t       vmVersion) const override
      {
         std::lock_guard lock{mutex};
         return index.count(Key{hash, vmOptions, vmVersion}) != 0;
      }

      WasmCacheStats stats() const override
      {
         return {compiled.load(), loaded.load(), artifacts ? artifacts->discarded() : 0,
                 compiledPoolless.load(), loadedPoolless.load(), compilesAbandoned.load()};
      }

      void add(const Checksum256& hash,
               const VMOptions&   vmOptions,
               std::uint8_t       vmVersion,
               const Compiled&    compiled)
      {
         std::lock_guard lock{mutex};
         Key             key{hash, vmOptions, vmVersion};
         refusedCode.erase(key);
         if (index.count(key))
            return;
         entries.push_back(Entry{key, compiled.module, compiled.poolless});
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
      // The module belongs to the engine without an instance pool.
      bool                                                   poolless = false;
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

         auto compiled = cache.get(code.codeHash, vmOptions, code.vmVersion);
         // Loading or compiling the code is not billed to the transaction.
         std::optional<TransactionContext::BillingPause> unbilled;
         if (!compiled)
            unbilled.emplace(transactionContext);
         if (!compiled)
         {
            // The limits may have changed since the code was stored: it is
            // admitted again before it is compiled here.
            compiled = cache.obtain(code.codeHash, vmOptions, code.vmVersion, floatProfile,
                                  [&]
                                  {
                                     loadCode();
                                     // Not in memory and not stored: it has
                                     // to be compiled. Whether this run
                                     // compiles it here, waits for a compile
                                     // or does not go on is the node's rule,
                                     // the same on every engine.
                                     transactionContext.codeNotCompiled(
                                         code.codeHash, code.vmVersion,
                                         [&]
                                         {
                                            return std::span<const char>(
                                                reinterpret_cast<const char*>(c->code.data()),
                                                c->code.size());
                                         });
                                     return std::span<const std::uint8_t>(c->code);
                                  });
            cache.add(code.codeHash, vmOptions, code.vmVersion, *compiled);
         }
         module   = compiled->module;
         poolless = compiled->poolless;
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
         if (poolless)
            instance.emplace(runtimes(cache.debug).unpooled(floatProfile), *module, *this, limits);
         else
            try
            {
               instance.emplace(runtimes(cache.debug).pooled(floatProfile), *module, *this,
                                limits);
            }
            catch (const wt::instantiation_error&)
            {

            // No slot is free, or this module does not fit one. Nothing has
            // run; the engine without a pool creates the same instance, or
            // reports why none can be created.
            module = cache.unpooled(code.codeHash, vmOptions, code.vmVersion, floatProfile,
                                    *module);
            instance.emplace(runtimes(cache.debug).unpooled(floatProfile), *module, *this,
                             limits);
         }
         {
            std::lock_guard lock{interruptMutex};
            interrupter.emplace(instance->make_interrupter());
            if (timedOut)
               interrupter->fire();
         }
         instance->set_stack_remaining(stack);
         instance->run_start();
         instance->enter(wt::entry_point::start, currentActContext->action.service.value);
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
            logFailureBacktrace();
            // A synchronous storage check can observe expiry before the
            // watchdog thread has delivered asyncTimeout to this VM.
            throw TimeoutException{};
         }
         catch (...)
         {
            logFailureBacktrace();
            if (timedOut)
               throw TimeoutException{};
            throw;
         }
      }

      // Tells the developer at this node where in the service the call that
      // just failed was (psizam keeps no frames of an earlier call). Each service on the call path logs its own frames as
      // the failure passes through it, the one that failed first. This goes to
      // the log and nowhere else: traces and state are compared between nodes,
      // and most of them do not debug.
      void logFailureBacktrace()
      {
         if (!cache.debug || !instance)
            return;
         const auto frames = instance->failure_backtrace();
         if (frames.empty())
            return;
         std::string text;
         for (std::size_t i = 0; i < frames.size(); ++i)
         {
            const auto& frame = frames[i];
            text += "\n  " + std::to_string(i) + ": " +
                    (frame.function_name.empty() ? "<unnamed>" : frame.function_name) + " (" +
                    std::to_string(frame.function_index) + ")";
            if (frame.module_offset)
            {
               char offset[32];
               std::snprintf(offset, sizeof(offset), " +0x%llx",
                             static_cast<unsigned long long>(*frame.module_offset));
               text += offset;
            }
            if (!frame.file.empty())
               text += " at " + frame.file + ":" + std::to_string(frame.line);
            // Runaway recursion is the same frame over and over.
            std::size_t same = 0;
            while (i + 1 < frames.size() &&
                   frames[i + 1].function_index == frame.function_index &&
                   frames[i + 1].module_offset == frame.module_offset)
               ++i, ++same;
            if (same)
               text += " (and " + std::to_string(same) + " more of the same)";
         }
         if (frames.size() == backtraceFrames)
            text += "\n  (outer frames not shown)";
         PSIBASE_LOG(loggers::generic::get(), warning)
             << "service " << code.codeNum.str() << " failed here (wasm frames, innermost first):"
             << text;
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

   namespace
   {
      Runtimes::Runtimes(bool debug)
          : pooledStrict{pooledRuntime(psizam::float_profile::strict, debug)},
            pooledPerformance{pooledRuntime(psizam::float_profile::performance, debug)},
            unpooledStrict{engineOptions(psizam::float_profile::strict, debug)},
            unpooledPerformance{engineOptions(psizam::float_profile::performance, debug)}
      {
         // The list every engine registers and admission checks imports
         // against (NativeHostFunctions.hpp). The signature wasmtime derives
         // for each must be the admission table's, or the node does not
         // start.
         auto check = [](const wt::abi::PzwtImport& import)
         {
            auto encoded = [](const std::uint8_t* types, std::size_t count)
            {
               // wasmtime_backend.hpp numbers i32, i64, f32, f64 from 0; a
               // module encodes them as 0x7f down to 0x7c.
               std::vector<std::uint8_t> result;
               for (std::size_t i = 0; i < count; ++i)
                  result.push_back(static_cast<std::uint8_t>(0x7f - types[i]));
               return result;
            };
            checkNativeHostFunction("wasmtime", {import.name, import.name_len},
                                    encoded(import.params, import.params_len),
                                    encoded(import.results, import.results_len));
         };
         std::size_t count = 0;
#define PSIBASE_HOST_FUNCTION(name)                                                  \
   check(wt::detail::make_import<ExecutionContextImpl, &ExecutionContextImpl::name>( \
       &ExecutionContextImpl::name, "env", #name));                                  \
   ++count;
         PSIBASE_ALL_HOST_FUNCTIONS(PSIBASE_HOST_FUNCTION)
#undef PSIBASE_HOST_FUNCTION
         checkNativeHostFunctionCount("wasmtime", count);
         // Both engines of a profile import the same host functions.
         for (auto* runtime :
              {&pooledStrict, &pooledPerformance, &unpooledStrict, &unpooledPerformance})
         {
            auto& rt = *runtime;
#define PSIBASE_HOST_FUNCTION(name) rt.add<&ExecutionContextImpl::name>("env", #name);
            PSIBASE_ALL_HOST_FUNCTIONS(PSIBASE_HOST_FUNCTION)
#undef PSIBASE_HOST_FUNCTION
            rt.link();
         }
      }

      Runtimes& runtimes(bool debug)
      {
         if (debug)
         {
            static Runtimes debugging{true};
            return debugging;
         }
         static Runtimes plain{false};
         return plain;
      }
   }  // namespace

   // Makes the engines the node is about to use, so that one it cannot make
   // stops the node as it starts rather than at its first transaction.
   static void registerHostFunctions()
   {
      runtimes(vm::serviceDebugging());
   }

   std::uint32_t ExecutionContextImpl::remainingStack() const
   {
      return instance ? instance->stack_remaining()
                            : transactionContext.remainingStack;
   }

   void ExecutionContextImpl::execProcessTransaction(ActionContext& actionContext)
   {
      run(actionContext,
                 [&] { instance->enter(wt::entry_point::process_transaction); });
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
                    // The entry points were found, and their signatures
                    // checked, when the module was compiled: entering one
                    // looks nothing up by name.
                    instance->enter(wt::entry_point::called,
                                    actionContext.action.service.value,
                                    actionContext.action.sender.value);
                 });
   }

   void ExecutionContextImpl::execServe(ActionContext& actionContext)
   {
      run(actionContext, [&] { instance->enter(wt::entry_point::serve); });
   }

   void ExecutionContextImpl::exec(ActionContext& actionContext, std::string_view fn)
   {
      // A callback named by the caller: rare, and looked up by name. Like an
      // entry point it takes nothing and returns nothing.
      run(actionContext, [&] { instance->call<void>(fn); });
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
          +[](std::uint32_t                   cacheSize,
              std::shared_ptr<NativeAotCache> artifacts) -> std::shared_ptr<vm::Cache>
          { return std::make_shared<WasmCacheImpl>(cacheSize, std::move(artifacts)); },
          +[]() -> std::unique_ptr<vm::Memory> { return std::make_unique<ExecutionMemoryImpl>(); },
          +[](TransactionContext& transactionContext, const VMOptions& vmOptions, vm::Memory&,
              vm::Cache& cache, AccountNumber service) -> std::unique_ptr<vm::Context>
          {
             return std::make_unique<ExecutionContextImpl>(
                 transactionContext, vmOptions, static_cast<WasmCacheImpl&>(cache), service);
          },
          true};
      return result;
   }
}  // namespace psibase::vm_wasmtime
