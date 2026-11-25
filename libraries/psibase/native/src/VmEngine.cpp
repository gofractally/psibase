// ExecutionContext.hpp, implemented on top of whichever engines this build
// has. See VmEngine.hpp.

#include <psibase/VmEngine.hpp>

#include <psibase/BlockContext.hpp>
#include <psibase/NativeAotCache.hpp>
#include <psibase/TransactionContext.hpp>
#include <psibase/db.hpp>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdlib>
#include <deque>
#include <map>
#include <mutex>
#include <set>
#include <stdexcept>
#include <string>
#include <thread>
#include <tuple>
#include <utility>

#if defined(__APPLE__)
#include <pthread.h>
#include <sys/qos.h>
#endif

// The build generates one PSIBASE_VM_ENGINE(namespace) line per engine.
namespace psibase
{
#define PSIBASE_VM_ENGINE(ns)     \
   namespace ns                   \
   {                              \
      const vm::Engine& engine(); \
   }
#include <psibase-vm-engines.inc>
#undef PSIBASE_VM_ENGINE
}  // namespace psibase

namespace psibase::vm
{
   namespace
   {
      const std::vector<const Engine*>& all()
      {
         static const std::vector<const Engine*> result{
#define PSIBASE_VM_ENGINE(ns) &ns::engine(),
#include <psibase-vm-engines.inc>
#undef PSIBASE_VM_ENGINE
         };
         return result;
      }

      const Engine* find(std::string_view name)
      {
         for (auto* engine : all())
            if (engine->name == name)
               return engine;
         return nullptr;
      }

      std::string known()
      {
         std::string result;
         for (auto* engine : all())
            result += (result.empty() ? "" : ", ") + std::string(engine->name);
         return result;
      }

      std::atomic<const Engine*>& choice()
      {
         static std::atomic<const Engine*> result{
             []
             {
                const char* name = std::getenv("PSIBASE_VM_ENGINE");
                if (!name || !*name)
                   return all().front();
                if (auto* engine = find(name))
                   return engine;
                throw std::runtime_error("PSIBASE_VM_ENGINE=" + std::string(name) +
                                         " is not an engine in this build (" + known() + ")");
             }()};
         return result;
      }

      std::atomic<bool>& debugging()
      {
         static std::atomic<bool> result{[]
                                         {
                                            const char* value =
                                                std::getenv("PSIBASE_DEBUG_SERVICES");
                                            return value && *value &&
                                                   std::string_view(value) != "0";
                                         }()};
         return result;
      }
   }  // namespace

   std::span<const Engine* const> engines()
   {
      return all();
   }

   const Engine& selected()
   {
      return *choice().load();
   }

   void select(std::string_view name)
   {
      auto* engine = find(name);
      if (!engine)
         throw std::runtime_error("no execution engine named " + std::string(name) +
                                  " in this build (" + known() + ")");
      choice().store(engine);
   }

   bool serviceDebugging()
   {
      return debugging().load();
   }

   void setServiceDebugging(bool enabled)
   {
      debugging().store(enabled);
   }
}  // namespace psibase::vm

namespace psibase
{
   // Only useful for genesis
   void setCode(Database&          database,
                AccountNumber      service,
                uint8_t            vmType,
                uint8_t            vmVersion,
                std::span<const char> code)
   {
      check(code.size(), "native setCode can't clear code");
      auto codeHash = sha256(code.data(), code.size());

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
         codeObj->code.assign(code.begin(), code.end());
      }
      database.kvPut(CodeByHashRow::db, codeObj->key(), *codeObj);
   }  // setCode

   // The node's rule for when code is compiled (WasmCache, ExecutionContext.hpp)
   // on top of what an engine provides. An engine with compile threads of its
   // own (LLVM AOT) is asked through vm::Cache; for one whose compileAhead
   // compiles before it returns (wasmtime) the compile threads are here.
   struct WasmCacheImpl
   {
      using Key = std::tuple<Checksum256, VMOptions, std::uint8_t>;
      struct Job
      {
         Key               key;
         std::vector<char> code;
      };
      // As the LLVM AOT adapter's own queue: beyond this, code waits for
      // its first execution.
      static constexpr std::size_t maxQueuedCompiles = 256;

      const vm::Engine*          engine;
      std::shared_ptr<vm::Cache> cache;

      std::mutex               mutex;
      std::condition_variable  jobReady;
      std::condition_variable  compileDone;
      std::deque<Job>          jobs;
      // Queued or running here.
      std::set<Key>            inFlight;
      std::vector<std::thread> workers;
      bool                     stopping = false;
      // WasmCache::onCompilesFinished; called and replaced under its mutex.
      std::mutex               finishedMutex;
      std::function<void()>    finished;
      std::atomic<std::chrono::nanoseconds::rep> speculativeWait{[]
      {
         std::chrono::nanoseconds result = std::chrono::seconds(5);
         if (const char* value = std::getenv("PSIBASE_SPECULATIVE_COMPILE_MS"); value && *value)
         {
            char* end   = nullptr;
            auto  count = std::strtoull(value, &end, 10);
            if (end && !*end && count <= 24ull * 60 * 60 * 1000)
               result = std::chrono::milliseconds(count);
         }
         return result.count();
      }()};

      WasmCacheImpl(const vm::Engine* engine, std::shared_ptr<vm::Cache> cache)
          : engine(engine), cache(std::move(cache))
      {
      }
      ~WasmCacheImpl()
      {
         {
            std::lock_guard lock{mutex};
            stopping = true;
            // What has not started is dropped: it is compiled when it is
            // first executed. What is running finishes; a thread inside the
            // compiler is never stopped.
            for (const auto& job : jobs)
               inFlight.erase(job.key);
            jobs.clear();
         }
         jobReady.notify_all();
         compileDone.notify_all();
         for (auto& worker : workers)
            worker.join();
      }

      void runCompiles()
      {
#if defined(__APPLE__)
         // Runs are waiting on these threads; without a class they are
         // scheduled as background work on the efficiency cores.
         pthread_set_qos_class_self_np(QOS_CLASS_USER_INITIATED, 0);
#endif
         std::unique_lock lock{mutex};
         for (;;)
         {
            jobReady.wait(lock, [&] { return stopping || !jobs.empty(); });
            if (stopping)
               return;
            Job job = std::move(jobs.front());
            jobs.pop_front();
            lock.unlock();
            try
            {
               const auto& [hash, options, vmVersion] = job.key;
               // Logs what it cannot compile and does not throw. A refusal
               // is recorded by the engine (vm::Cache::refused) before this
               // returns, so it is known by the time the key leaves inFlight.
               cache->compileAhead(hash, job.code, options, vmVersion);
            }
            catch (...)
            {
            }
            lock.lock();
            inFlight.erase(job.key);
            compileDone.notify_all();
            if (inFlight.empty())
            {
               lock.unlock();
               {
                  std::lock_guard callback{finishedMutex};
                  if (finished)
                     finished();
               }
               lock.lock();
            }
         }
      }

      // Compiles queued or running, here or in the engine.
      std::size_t compilesInFlight()
      {
         if (cache->compilesInBackground())
            return cache->compilesInFlight();
         std::lock_guard lock{mutex};
         return inFlight.size();
      }

      bool compiling(const Key& key)
      {
         const auto& [hash, options, vmVersion] = key;
         if (cache->compilesInBackground())
            return !cache->awaitCompile(hash, options, vmVersion, std::chrono::nanoseconds(0));
         std::lock_guard lock{mutex};
         return inFlight.count(key) != 0;
      }

      WasmCache::CompileStart start(const Key&                 key,
                                    std::span<const char>      code,
                                    std::optional<std::size_t> cap)
      {
         const auto& [hash, options, vmVersion] = key;
         if (cache->contains(hash, options, vmVersion))
            return WasmCache::CompileStart::ready;
         if (cache->compilesInBackground())
         {
            if (compiling(key))
               return WasmCache::CompileStart::inFlight;
            if (cap && cache->compilesInFlight() >= *cap)
               return WasmCache::CompileStart::full;
            cache->compileAhead(hash, code, options, vmVersion);
            return WasmCache::CompileStart::started;
         }
         std::lock_guard lock{mutex};
         if (inFlight.count(key))
            return WasmCache::CompileStart::inFlight;
         if (cap && inFlight.size() >= *cap)
            return WasmCache::CompileStart::full;
         // Not queued: it is compiled where it is first executed.
         if (stopping || jobs.size() >= maxQueuedCompiles)
            return WasmCache::CompileStart::inFlight;
         inFlight.insert(key);
         jobs.push_back(Job{key, {code.begin(), code.end()}});
         if (workers.size() < WasmCache::maxSpeculativeCompiles && workers.size() < inFlight.size())
            workers.emplace_back([this] { runCompiles(); });
         jobReady.notify_one();
         return WasmCache::CompileStart::started;
      }

      bool await(const Key& key, std::optional<std::chrono::nanoseconds> limit)
      {
         const auto& [hash, options, vmVersion] = key;
         if (cache->compilesInBackground())
            return cache->awaitCompile(hash, options, vmVersion, limit);
         std::unique_lock lock{mutex};
         auto             done = [&] { return inFlight.count(key) == 0; };
         if (!limit)
         {
            compileDone.wait(lock, done);
            return true;
         }
         return compileDone.wait_for(lock, *limit, done);
      }
   };

   WasmCache::WasmCache(uint32_t cacheSize, const std::filesystem::path& nativeArtifactPath)
       : WasmCache(cacheSize,
                   nativeArtifactPath.empty()
                       ? nullptr
                       : std::make_shared<NativeAotCache>(nativeArtifactPath))
   {
   }
   WasmCache::WasmCache(uint32_t cacheSize, std::shared_ptr<NativeAotCache> artifacts)
   {
      auto& engine = vm::selected();
      // Asked to debug, an engine that cannot must not quietly run without.
      if (vm::serviceDebugging() && !engine.serviceDebugging)
         throw std::runtime_error("execution engine " + std::string(engine.name) +
                                  " cannot debug services");
      impl = std::make_shared<WasmCacheImpl>(&engine,
                                             engine.makeCache(cacheSize, std::move(artifacts)));
   }
   WasmCache::WasmCache(const vm::Engine& engine, std::shared_ptr<vm::Cache> cache)
       : impl{std::make_shared<WasmCacheImpl>(&engine, std::move(cache))}
   {
   }
   WasmCache::WasmCache(const WasmCache& src) : impl{src.impl} {}
   WasmCache::WasmCache(WasmCache&& src) : impl{std::move(src.impl)} {}
   WasmCache::~WasmCache() {}

   std::vector<std::span<const char>> WasmCache::span() const
   {
      return impl->cache->span();
   }

   void WasmCache::compileAhead(const Checksum256&    hash,
                                std::span<const char> code,
                                const VMOptions&      options,
                                std::uint8_t          vmVersion)
   {
      impl->cache->compileAhead(hash, code, options, vmVersion);
   }

   void WasmCache::finishCompiles()
   {
      {
         std::unique_lock lock{impl->mutex};
         impl->compileDone.wait(lock, [&] { return impl->inFlight.empty(); });
      }
      impl->cache->finishCompiles();
   }

   bool WasmCache::contains(const Checksum256& hash,
                            const VMOptions&   options,
                            std::uint8_t       vmVersion) const
   {
      return impl->cache->contains(hash, options, vmVersion);
   }

   WasmCacheStats WasmCache::stats() const
   {
      return impl->cache->stats();
   }

   WasmCache::CompileStart WasmCache::compileInBackground(const Checksum256&         hash,
                                                          std::span<const char>      code,
                                                          const VMOptions&           options,
                                                          std::uint8_t               vmVersion,
                                                          std::optional<std::size_t> cap)
   {
      return impl->start({hash, options, vmVersion}, code, cap);
   }

   bool WasmCache::awaitCompile(const Checksum256&                      hash,
                                const VMOptions&                        options,
                                std::uint8_t                            vmVersion,
                                std::optional<std::chrono::nanoseconds> limit)
   {
      return impl->await({hash, options, vmVersion}, limit);
   }

   bool WasmCache::mustDefer(const Checksum256&                            hash,
                             const std::function<std::span<const char>()>& code,
                             const VMOptions&                              options,
                             std::uint8_t                                  vmVersion)
   {
      // The common case: it is there. "There" is what the engine's
      // contains() says, and on wasmtime that is the memory cache only: a
      // module that is in the artifact store but not in memory is deferred
      // here for one block although loading it takes milliseconds. That is
      // deliberate for the write of a code row (the load is done by the
      // compile thread started below); do not read "compiled" as "in
      // memory or stored". At first use the wasmtime adapter looks in the
      // store itself before it asks, so a restarted producer defers nothing.
      if (impl->cache->contains(hash, options, vmVersion))
         return false;
      const WasmCacheImpl::Key key{hash, options, vmVersion};
      if (impl->compiling(key))
         return true;
      // The engine says a compile of this code ended without a module: its
      // compiler refuses it. Waiting for another compile would never end;
      // the transaction goes on, and the code fails where it is executed,
      // as on a node that never deferred. The same question on every
      // engine, whoever's threads compile; nothing is inferred here from
      // the module being absent.
      if (impl->cache->refused(hash, options, vmVersion))
         return false;
      // Anything else that is absent is not compiled yet (never compiled,
      // or compiled and evicted since): start a compile and defer. If it
      // arrived in the meantime there is nothing to wait for.
      return impl->start(key, code(), std::nullopt) != CompileStart::ready;
   }

   std::chrono::nanoseconds WasmCache::speculativeCompileWait() const
   {
      return std::chrono::nanoseconds(impl->speculativeWait.load());
   }
   void WasmCache::setSpeculativeCompileWait(std::chrono::nanoseconds limit)
   {
      impl->speculativeWait.store(limit.count());
   }

   void WasmCache::onCompilesFinished(std::function<void()> callback)
   {
      std::lock_guard lock{impl->finishedMutex};
      impl->finished = std::move(callback);
   }

   void WasmCache::setCompileHook(std::function<void(const Checksum256&)> hook)
   {
      impl->cache->compileHook = std::move(hook);
   }

   const vm::Engine& vm::engineOf(const WasmCache& cache)
   {
      return *cache.impl->engine;
   }

   // A memory slot is created before anything says which engine will use it,
   // so each engine's part is made the first time that engine needs it.
   struct ExecutionMemoryImpl
   {
      std::vector<std::pair<const vm::Engine*, std::unique_ptr<vm::Memory>>> parts;

      vm::Memory& get(const vm::Engine& engine)
      {
         for (auto& [owner, memory] : parts)
            if (owner == &engine)
               return *memory;
         return *parts.emplace_back(&engine, engine.makeMemory()).second;
      }
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
      for (auto& [owner, memory] : impl->parts)
         if (auto bytes = memory->span(); !bytes.empty())
            return bytes;
      return {};
   }

   struct ExecutionContextImpl
   {
      std::unique_ptr<vm::Context> context;
   };

   ExecutionContext::ExecutionContext(TransactionContext& transactionContext,
                                      const VMOptions&    vmOptions,
                                      ExecutionMemory&    memory,
                                      AccountNumber       service)
   {
      auto& cache   = *transactionContext.blockContext.systemContext.wasmCache.impl;
      impl          = std::make_unique<ExecutionContextImpl>();
      impl->context = cache.engine->makeContext(transactionContext, vmOptions,
                                                memory.impl->get(*cache.engine), *cache.cache,
                                                service);
      impl->context->rebind(this);
   }

   ExecutionContext::ExecutionContext(ExecutionContext&& src)
   {
      impl = std::move(src.impl);
      impl->context->rebind(this);
   }
   ExecutionContext::~ExecutionContext() {}

   void ExecutionContext::registerHostFunctions()
   {
      for (auto* engine : vm::engines())
         engine->registerHostFunctions();
   }

   std::uint32_t ExecutionContext::remainingStack() const
   {
      return impl->context->remainingStack();
   }
   void ExecutionContext::execProcessTransaction(ActionContext& actionContext)
   {
      impl->context->execProcessTransaction(actionContext);
   }
   void ExecutionContext::execCalled(uint64_t callerFlags, ActionContext& actionContext)
   {
      impl->context->execCalled(callerFlags, actionContext);
   }
   void ExecutionContext::execServe(ActionContext& actionContext)
   {
      impl->context->execServe(actionContext);
   }
   void ExecutionContext::exec(ActionContext& actionContext, std::string_view fn)
   {
      impl->context->exec(actionContext, fn);
   }
   void ExecutionContext::asyncTimeout()
   {
      impl->context->asyncTimeout();
   }
}  // namespace psibase
