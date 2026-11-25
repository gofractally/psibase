#include <psibase/NativeFunctions.hpp>

#include <atomic>
#if defined(__APPLE__)
#include <pthread/qos.h>
#endif
#include <condition_variable>
#include <deque>
#include <future>
#include <chrono>
#include <map>
#include <optional>
#include <set>
#include <thread>
#include <boost/multi_index/key.hpp>
#include <boost/multi_index/ordered_index.hpp>
#include <boost/multi_index/sequenced_index.hpp>
#include <boost/multi_index_container.hpp>
#include <mutex>
#include <psibase/ActionContext.hpp>
#include <psibase/PsizamPolicy.hpp>
#include <psibase/NativeAotCache.hpp>
#include <psibase/NativeHostFunctions.hpp>
#include <psibase/db.hpp>
#include <psibase/finally.hpp>
#include <psibase/NativeVM.hpp>
#include <psibase/VmEngine.hpp>
#include <psizam/debug/debug.hpp>

// This file is one engine per psizam profile. A build with several engines
// compiles it once for each, so everything in it lives in the namespace of the
// profile it was compiled for.
#if defined(PSIBASE_VM_ADAPTER_JIT1)
#define PSIBASE_VM_ENGINE_NS vm_jit1
#define PSIBASE_VM_ENGINE_NAME "jit1"
#elif defined(PSIBASE_VM_ADAPTER_JIT2)
#define PSIBASE_VM_ENGINE_NS vm_jit2
#define PSIBASE_VM_ENGINE_NAME "jit2"
#elif defined(PSIBASE_VM_LLVM_AOT)
#define PSIBASE_VM_ENGINE_NS vm_llvm_aot
#define PSIBASE_VM_ENGINE_NAME "llvm-aot"
#elif defined(PSIBASE_VM_JIT2)
#define PSIBASE_VM_ENGINE_NS vm_jit2
#define PSIBASE_VM_ENGINE_NAME "jit2"
#elif defined(PSIBASE_VM_JIT1)
#define PSIBASE_VM_ENGINE_NS vm_jit1
#define PSIBASE_VM_ENGINE_NAME "jit1"
#else
#error A psizam profile must be selected for this engine
#endif

namespace bmi = boost::multi_index;

using std::span;
namespace dwarf = psizam::debug;

namespace psibase::PSIBASE_VM_ENGINE_NS
{
   struct ExecutionContextImpl;
   using rhf_t  = psizam::registered_host_functions<ExecutionContextImpl>;
   using impl_t = NativeVM;
   using backend_t =
       psizam::backend<rhf_t, impl_t, NativeVMOptions, psizam::debug::debug_instr_map>;

   // Rethrow with detailed info
   template <typename F>
   void rethrowVMExcept(F f)
   {
      try
      {
         f();
      }
      catch (const psizam::exception& e)
      {
         throw std::runtime_error(std::string(e.what()) + ": " + e.detail());
      }
   }

   struct BackendEntry
   {
      Checksum256                hash;
      VMOptions                  vmOptions;
      // Code under different versions compiles differently from the same bytes.
      std::uint8_t               vmVersion = 0;
      std::unique_ptr<backend_t>                    backend;
      std::shared_ptr<dwarf::debugger_registration> debug;
      // The module's entry points, checked to have their fixed signatures
      // when the backend was made: the service is entered by these function
      // indices (gofractally/psibase#2261).
      NativeEntryPoints                             entryPoints;

      auto byHash() const { return std::tie(hash, vmOptions, vmVersion); }
   };

   struct ByAge;
   struct ByHash;

   using BackendContainer = bmi::multi_index_container<
       BackendEntry,
       bmi::indexed_by<bmi::sequenced<bmi::tag<ByAge>>,
                       bmi::ordered_non_unique<bmi::tag<ByHash>, bmi::key<&BackendEntry::byHash>>>>;

   struct WasmCacheImpl : vm::Cache
   {
      mutable std::mutex mutex;
      uint32_t           cacheSize;
      BackendContainer   backends;
      std::shared_ptr<NativeAotCache> nativeArtifacts;

      WasmCacheImpl(uint32_t cacheSize, std::shared_ptr<NativeAotCache> artifacts)
          : cacheSize{cacheSize},
            nativeArtifacts(artifacts ? std::move(artifacts) : nativeAotCacheFromEnvironment())
      {
      }

      // Compiling a service to native code takes seconds. It starts when the
      // code is stored, on these threads, so it overlaps the rest of the
      // transaction that installed it and other compiles. The first execution
      // waits for it; it never runs the service on another engine instead.
      using PendingKey = std::tuple<Checksum256, VMOptions, std::uint8_t>;
      struct Job
      {
         PendingKey                 key;
         std::vector<std::uint8_t>  code;
         std::promise<void>         done;
      };
      static constexpr std::size_t           maxQueuedCompiles = 256;
      std::condition_variable                jobReady;
      std::condition_variable                compilesIdle;
      std::deque<Job>                        jobs;
      std::map<PendingKey, std::shared_future<void>> pending;
      std::vector<std::thread>               workers;
      bool                                   stopping = false;

      ~WasmCacheImpl()
      {
         {
            std::lock_guard lock{mutex};
            stopping = true;
         }
         jobReady.notify_all();
         for (auto& worker : workers)
            worker.join();
      }

      void compileAhead(const Checksum256&    hash,
                        std::span<const char> code,
                        const VMOptions&      options,
                        std::uint8_t          vmVersion) override;
      std::vector<std::span<const char>> span() const override;
      void                               runCompiles();
      void                               finishCompiles() override
      {
         std::unique_lock lock{mutex};
         compilesIdle.wait(lock, [&] { return pending.empty(); });
      }

      // What WasmCache needs for the node's rule of when code is compiled
      // (VmEngine.hpp, gofractally/psibase#2256). Added for that rule and
      // NOT RUN: LLVM AOT is not built where this was written.
      //
      // Code this cache has made a backend for since the process started.
      // A backend is checked out of `backends` while a transaction runs it,
      // so `backends` alone would report popular code as missing.
      std::set<PendingKey> known;
#if defined(PSIBASE_VM_LLVM_AOT)
      bool compilesInBackground() const override { return true; }
      bool contains(const Checksum256& hash,
                    const VMOptions&   options,
                    std::uint8_t       vmVersion) const override
      {
         std::lock_guard lock{mutex};
         return known.contains(PendingKey{hash, options, vmVersion});
      }
      // The timed form of awaitCompile below. It never takes a queued
      // compile over: the caller is not going to compile.
      bool awaitCompile(const Checksum256&                      hash,
                        const VMOptions&                        options,
                        std::uint8_t                            vmVersion,
                        std::optional<std::chrono::nanoseconds> limit) override
      {
         if (!limit)
         {
            awaitCompile(hash, options, vmVersion);
            return true;
         }
         std::shared_future<void> done;
         {
            std::lock_guard lock{mutex};
            auto            it = pending.find(PendingKey{hash, options, vmVersion});
            if (it == pending.end())
               return true;
            done = it->second;
         }
         return done.wait_for(*limit) == std::future_status::ready;
      }
      std::size_t compilesInFlight() const override
      {
         std::lock_guard lock{mutex};
         return pending.size();
      }
#else
      // The JITs compile in milliseconds where the code is first executed:
      // there is never a compile to wait for or to keep a producer from.
      bool contains(const Checksum256&, const VMOptions&, std::uint8_t) const override
      {
         return true;
      }
#endif

      // Blocks until a compile started for this code, if any, has finished.
      void awaitCompile(const Checksum256& hash, const VMOptions& options, std::uint8_t vmVersion)
      {
         std::shared_future<void> done;
         {
            std::lock_guard lock{mutex};
            auto            it = pending.find(PendingKey{hash, options, vmVersion});
            if (it == pending.end())
               return;
            // Still queued behind other code: the caller needs it now, and
            // compiles it itself rather than waiting for a free thread.
            for (auto job = jobs.begin(); job != jobs.end(); ++job)
            {
               if (job->key == it->first)
               {
                  job->done.set_value();
                  jobs.erase(job);
                  pending.erase(it);
                  compilesIdle.notify_all();
                  return;
               }
            }
            done = it->second;
         }
         done.wait();
      }

      void add(BackendEntry&& entry)
      {
         std::lock_guard<std::mutex> lock{mutex};
         auto&                       ind = backends.get<ByAge>();
         ind.push_back(std::move(entry));
         while (ind.size() > cacheSize)
            ind.pop_front();
      }

      BackendEntry get(const Checksum256& hash, const VMOptions& vmOptions, std::uint8_t vmVersion)
      {
         BackendEntry                result{hash, vmOptions, vmVersion};
         std::lock_guard<std::mutex> lock{mutex};
         auto&                       ind = backends.get<ByHash>();
         auto                        it  = ind.find(std::tie(hash, vmOptions, vmVersion));
         if (it == ind.end())
            return result;
         ind.modify(it, [&](auto& x) { result = std::move(x); });
         ind.erase(it);
         result.backend->get_module().allocator.enable_code(impl_t::is_jit);
         return result;
      }
   };

   void WasmCacheImpl::compileAhead(const Checksum256&    hash,
                                    std::span<const char> code,
                                    const VMOptions&      options,
                                    std::uint8_t          vmVersion)
   {
#if defined(PSIBASE_VM_LLVM_AOT)
      if (!nativeFloatProfile(vmVersion))
         return;
      std::lock_guard lock{mutex};
      PendingKey      key{hash, options, vmVersion};
      if (stopping || jobs.size() >= maxQueuedCompiles || pending.contains(key) ||
          backends.get<ByHash>().find(std::tie(hash, options, vmVersion)) !=
              backends.get<ByHash>().end())
         return;
      Job job{key, {code.begin(), code.end()}, {}};
      pending.emplace(key, job.done.get_future().share());
      // Smallest first: compile time grows with size, and one large service
      // would otherwise hold a thread while many small ones wait behind it.
      auto position = std::find_if(jobs.begin(), jobs.end(), [&](const Job& queued)
                                   { return queued.code.size() > job.code.size(); });
      jobs.insert(position, std::move(job));
      const auto        cores  = std::thread::hardware_concurrency();
      const std::size_t wanted = std::clamp<std::size_t>(cores > 2 ? cores - 2 : 1, 1, 16);
      if (workers.size() < wanted && workers.size() < jobs.size())
         workers.emplace_back([this] { runCompiles(); });
      jobReady.notify_one();
#endif
   }

   void WasmCacheImpl::runCompiles()
   {
#if defined(__APPLE__)
      // Execution is waiting on these threads; without a class they are
      // scheduled as background work on the efficiency cores.
      pthread_set_qos_class_self_np(QOS_CLASS_USER_INITIATED, 0);
#endif
      for (;;)
      {
         std::unique_lock lock{mutex};
         jobReady.wait(lock, [&] { return stopping || !jobs.empty(); });
         if (stopping)
         {
            // Release anything still waiting; it compiles for itself.
            for (auto& job : jobs)
               job.done.set_value();
            jobs.clear();
            pending.clear();
            compilesIdle.notify_all();
            return;
         }
         Job job = std::move(jobs.front());
         jobs.pop_front();
         lock.unlock();
         try
         {
            // Code that fails here fails the same way, with its error
            // reported, when a transaction first executes it.
            const auto& [hash, limits, vmVersion] = job.key;
            NativeVMOptions options{limits, nativeArtifacts, vmVersion};
            validateNativeWasm(job.code, options);
            psizam::debug::binary::input_stream stream{
                reinterpret_cast<const char*>(job.code.data()), job.code.size()};
            if (!dwarf::has_debug_info(stream))
            {
               BackendEntry entry{hash, limits, vmVersion};
               entry.backend = std::make_unique<backend_t>(job.code, nullptr, options);
               entry.entryPoints = nativeEntryPoints(entry.backend->get_module());
               entry.debug   = dwarf::register_with_debugger(entry.backend->get_module());
               add(std::move(entry));
               std::lock_guard known_lock{mutex};
               known.insert(job.key);
            }
         }
         catch (...)
         {
         }
         lock.lock();
         pending.erase(job.key);
         lock.unlock();
         job.done.set_value();
         compilesIdle.notify_all();
      }
   }

   std::vector<std::span<const char>> WasmCacheImpl::span() const
   {
      std::vector<std::span<const char>> result;
      std::lock_guard                    lock{mutex};
      for (const auto& backend : backends)
      {
         auto& alloc = backend.backend->get_module().allocator;
         if (alloc._base)
            result.push_back({alloc._base, alloc._capacity});
         auto code = alloc.get_code_span();
         if (!code.empty())
            result.push_back({reinterpret_cast<const char*>(code.data()), code.size()});
      }
      return result;
   }

   struct ExecutionMemoryImpl : vm::Memory
   {
      psizam::wasm_allocator wa;
      std::span<const char>  span() const override { return wa.span(); }
   };

   // TODO: debugger
   struct ExecutionContextImpl : NativeFunctions, vm::Context
   {
      WasmCacheImpl&                                wasmCache;
      NativeVMOptions                               vmOptions;
      psizam::wasm_allocator&                       wa;
      BackendEntry                                  backend;
      std::shared_ptr<dwarf::debugger_registration> dbg;
      std::atomic<bool>                             timedOut    = false;
      bool                                          initialized = false;

      ExecutionContextImpl(TransactionContext&  transactionContext,
                           const VMOptions&     vmOptions,
                           ExecutionMemoryImpl& memory,
                           WasmCacheImpl&       wasmCache,
                           AccountNumber        service)
          : NativeFunctions{transactionContext.blockContext.db, transactionContext,
                            transactionContext.dbMode},
            wasmCache{wasmCache},
            vmOptions{vmOptions, wasmCache.nativeArtifacts},
            wa{memory.wa}
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
         this->vmOptions.float_profile = *profile;
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
                auto& cache = wasmCache;
                backend = cache.get(code.codeHash, vmOptions, code.vmVersion);
                // Waiting for a compile in flight, or compiling here, is not
                // billed to the transaction.
                //
                // NOT VERIFIED ON JIT1 OR JIT2: this file serves the psizam
                // engines (JIT2, LLVM AOT, JIT1). The watchdog-only CPU budget
                // changed the order here (cache first, pause only on a miss)
                // and the trace timing below. It was qualified on wasmtime;
                // LLVM AOT has since passed the native and end-to-end suites
                // on x86-64 Linux. A node built on JIT1 or JIT2 has not been
                // run (gofractally/psibase#2228): run their suites before
                // relying on one.
                std::optional<TransactionContext::BillingPause> unbilled;
                if (!backend.backend)
                {
                   unbilled.emplace(transactionContext);
                   // The node's rule for a module that is missing, the same
                   // on every engine: a producer's queued transaction is
                   // deferred here, a speculative run waits up to its bound.
                   transactionContext.codeNotCompiled(
                       code.codeHash, code.vmVersion,
                       [&]
                       {
                          loadCode();
                          return std::span<const char>(
                              reinterpret_cast<const char*>(c->code.data()), c->code.size());
                       });
                   cache.awaitCompile(code.codeHash, vmOptions, code.vmVersion);
                   backend = cache.get(code.codeHash, vmOptions, code.vmVersion);
                }
                if (!backend.backend)
                {
                   loadCode();
                   validateNativeWasm(c->code, this->vmOptions);
                   psizam::debug::binary::input_stream s{
                       reinterpret_cast<const char*>(c->code.data()), c->code.size()};
                   if (dwarf::has_debug_info(s))
                   {
                      psizam::debug::debug_instr_map debug;
                      backend.backend =
                          std::make_unique<backend_t>(c->code, nullptr, this->vmOptions, debug);
                      auto info     = dwarf::get_info_from_wasm(s);
                      backend.debug = dwarf::register_with_debugger(
                          info, debug.locs, backend.backend->get_module(), s);
                   }
                   else
                   {
                      backend.backend =
                          std::make_unique<backend_t>(c->code, nullptr, this->vmOptions);
                      backend.debug = dwarf::register_with_debugger(backend.backend->get_module());
                   }
                   // The same rule as when the code was stored.
                   backend.entryPoints = nativeEntryPoints(backend.backend->get_module());
                   std::lock_guard known_lock{cache.mutex};
                   cache.known.insert(
                       WasmCacheImpl::PendingKey{code.codeHash, vmOptions, code.vmVersion});
                }
             });
      }

      ~ExecutionContextImpl()
      {
         wasmCache.add(std::move(backend));
      }

      psizam::detail::stack_manager& getAltStack() { return transactionContext.getAltStack(); }

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

      void init()
      {
         rethrowVMExcept(
             [&]
             {
                // auto startTime = std::chrono::steady_clock::now();
                backend.backend->set_wasm_allocator(&wa);
                backend.backend->initialize(getAltStack(), this);
                enter(backend.entryPoints.start, "start",
                      currentActContext->action.service.value);
                initialized = true;
                // auto us     = std::chrono::duration_cast<std::chrono::microseconds>(
                //     std::chrono::steady_clock::now() - startTime);
                // std::cout << "init:   " << us.count() << " us\n";
             });
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

      // Enters the service through one of its entry points. Where the
      // module exports it, admission recorded its function index and checked
      // its signature (NativeEntryPoints), so the call goes by index and the
      // export list is not scanned for the name. Where it does not, the call
      // by name reports that, as it always did.
      template <typename... Args>
      void enter(const std::optional<std::uint32_t>& index, std::string_view name, Args... args)
      {
         if (index)
            backend.backend->call_by_index(getAltStack(), *this, *index, args...);
         else
            (*backend.backend)(getAltStack(), *this, "env", name, args...);
      }

      template <typename F>
      void run(ActionContext& actionContext, F f)
      {
         auto prev         = currentActContext;
         currentActContext = &actionContext;
         auto& vmContext = backend.backend->get_context();
         const auto previousStack = vmContext.get_remaining_call_depth();
         auto restore = psibase::finally{[&] {
            currentActContext = prev;
            vmContext.set_max_call_depth(previousStack);
         }};
         RecordActionTime timer{actionContext};
         try
         {
            backend.backend->get_context().set_max_call_depth(
                actionContext.transactionContext.remainingStack);
            if (!initialized)
               init();
            rethrowVMExcept(f);
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
      // The list every engine registers and admission checks imports
      // against (NativeHostFunctions.hpp).
#define PSIBASE_HOST_FUNCTION(name) rhf_t::add<&ExecutionContextImpl::name>("env", #name);
      PSIBASE_NATIVE_HOST_FUNCTIONS(PSIBASE_HOST_FUNCTION)
#undef PSIBASE_HOST_FUNCTION
      // What was registered is exactly the admission table, or the node
      // does not start.
      auto& registered = rhf_t::mappings::get();
      for (const auto& [import, index] : registered.named_mapping)
         checkNativeHostFunction(PSIBASE_VM_ENGINE_NAME, import.second,
                                 registered.host_functions[index].params,
                                 registered.host_functions[index].ret);
      checkNativeHostFunctionCount(PSIBASE_VM_ENGINE_NAME, registered.named_mapping.size());
   }

   std::uint32_t ExecutionContextImpl::remainingStack() const
   {
      return backend.backend->get_context().get_remaining_call_depth();
   }

   void ExecutionContextImpl::execProcessTransaction(ActionContext& actionContext)
   {
      run(actionContext, [&] {  //
         enter(backend.entryPoints.processTransaction, "processTransaction");
      });
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

      run(actionContext, [&] {  //
         enter(backend.entryPoints.called, "called", actionContext.action.service.value,
               actionContext.action.sender.value);
      });
   }

   void ExecutionContextImpl::execServe(ActionContext& actionContext)
   {
      run(actionContext, [&] {  //
         enter(backend.entryPoints.serve, "serve");
      });
   }

   void ExecutionContextImpl::exec(ActionContext& actionContext, std::string_view fn)
   {
      run(actionContext, [&] {  //
         (*backend.backend)(getAltStack(), *this, "env", fn);
      });
   }

   void ExecutionContextImpl::asyncTimeout()
   {
      timedOut = true;
      backend.backend->get_module().allocator.disable_code();
   }

   const vm::Engine& engine()
   {
      static const vm::Engine result{
          PSIBASE_VM_ENGINE_NAME,
          &registerHostFunctions,
          +[](std::uint32_t                   cacheSize,
              std::shared_ptr<NativeAotCache> artifacts) -> std::shared_ptr<vm::Cache>
          { return std::make_shared<WasmCacheImpl>(cacheSize, std::move(artifacts)); },
          +[]() -> std::unique_ptr<vm::Memory> { return std::make_unique<ExecutionMemoryImpl>(); },
          +[](TransactionContext& transactionContext, const VMOptions& vmOptions,
              vm::Memory& memory, vm::Cache& cache,
              AccountNumber service) -> std::unique_ptr<vm::Context>
          {
             return std::make_unique<ExecutionContextImpl>(
                 transactionContext, vmOptions, static_cast<ExecutionMemoryImpl&>(memory),
                 static_cast<WasmCacheImpl&>(cache), service);
          }};
      return result;
   }
}  // namespace psibase::PSIBASE_VM_ENGINE_NS
