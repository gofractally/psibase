#include <psibase/NativeFunctions.hpp>

#include <atomic>
#if defined(__APPLE__)
#include <pthread/qos.h>
#endif
#include <condition_variable>
#include <deque>
#include <future>
#include <map>
#include <thread>
#include <boost/multi_index/key.hpp>
#include <boost/multi_index/ordered_index.hpp>
#include <boost/multi_index/sequenced_index.hpp>
#include <boost/multi_index_container.hpp>
#include <mutex>
#include <psibase/ActionContext.hpp>
#include <psibase/PsizamPolicy.hpp>
#include <psibase/NativeAotCache.hpp>
#include <psibase/db.hpp>
#include <psio/finally.hpp>
#include <psibase/NativeVM.hpp>
#include <psizam/debug/debug.hpp>

namespace bmi = boost::multi_index;

using std::span;
namespace dwarf = psizam::debug;

namespace psibase
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
      std::unique_ptr<backend_t>                    backend;
      std::shared_ptr<dwarf::debugger_registration> debug;

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
      std::shared_ptr<NativeAotCache> nativeArtifacts;

      WasmCacheImpl(uint32_t cacheSize, const std::filesystem::path& path)
          : cacheSize{cacheSize},
            nativeArtifacts(path.empty() ? nativeAotCacheFromEnvironment()
                                         : std::make_shared<NativeAotCache>(path)) {}

      // Compiling a service to native code takes seconds. It starts when the
      // code is stored, on these threads, so it overlaps the rest of the
      // transaction that installed it and other compiles. The first execution
      // waits for it; it never runs the service on another engine instead.
      using PendingKey = std::pair<Checksum256, VMOptions>;
      struct Job
      {
         PendingKey                 key;
         std::vector<std::uint8_t>  code;
         std::promise<void>         done;
      };
      static constexpr std::size_t           maxQueuedCompiles = 256;
      std::condition_variable                jobReady;
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

      void compileAhead(const Checksum256& hash, std::span<const char> code, const VMOptions& options);
      void runCompiles();

      // Blocks until a compile started for this code, if any, has finished.
      void awaitCompile(const Checksum256& hash, const VMOptions& options)
      {
         std::shared_future<void> done;
         {
            std::lock_guard lock{mutex};
            auto            it = pending.find(PendingKey{hash, options});
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
         result.backend->get_module().allocator.enable_code(impl_t::is_jit);
         return result;
      }
   };

   void WasmCacheImpl::compileAhead(const Checksum256&    hash,
                                    std::span<const char> code,
                                    const VMOptions&      options)
   {
#if defined(PSIBASE_VM_LLVM_AOT)
      std::lock_guard lock{mutex};
      PendingKey      key{hash, options};
      if (stopping || jobs.size() >= maxQueuedCompiles || pending.contains(key) ||
          backends.get<ByHash>().find(std::tie(hash, options)) != backends.get<ByHash>().end())
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
            return;
         }
         Job job = std::move(jobs.front());
         jobs.pop_front();
         lock.unlock();
         try
         {
            // Code that fails here fails the same way, with its error
            // reported, when a transaction first executes it.
            NativeVMOptions options{job.key.second, nativeArtifacts};
            validateNativeWasm(job.code, options);
            psizam::debug::binary::input_stream stream{
                reinterpret_cast<const char*>(job.code.data()), job.code.size()};
            if (!dwarf::has_debug_info(stream))
            {
               BackendEntry entry{job.key.first, job.key.second};
               entry.backend = std::make_unique<backend_t>(job.code, nullptr, options);
               entry.debug   = dwarf::register_with_debugger(entry.backend->get_module());
               add(std::move(entry));
            }
         }
         catch (...)
         {
         }
         lock.lock();
         pending.erase(job.key);
         lock.unlock();
         job.done.set_value();
      }
   }

   void WasmCache::compileAhead(const Checksum256&    hash,
                                std::span<const char> code,
                                const VMOptions&      options)
   {
      impl->compileAhead(hash, code, options);
   }

   WasmCache::WasmCache(uint32_t cacheSize, const std::filesystem::path& nativeArtifactPath)
       : impl{std::make_shared<WasmCacheImpl>(cacheSize, nativeArtifactPath)} {}

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
         if (alloc._base)
            result.push_back({alloc._base, alloc._capacity});
         auto code = alloc.get_code_span();
         if (!code.empty())
            result.push_back({reinterpret_cast<const char*>(code.data()), code.size()});
      }
      return result;
   }

   struct ExecutionMemoryImpl
   {
      psizam::wasm_allocator wa;
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
      return impl->wa.span();
   }

   // TODO: debugger
   struct ExecutionContextImpl : NativeFunctions
   {
      NativeVMOptions                               vmOptions;
      psizam::wasm_allocator&                       wa;
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
            vmOptions{vmOptions,
                      transactionContext.blockContext.systemContext.wasmCache.impl->nativeArtifacts},
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
                auto& cache = *transactionContext.blockContext.systemContext.wasmCache.impl;
                cache.awaitCompile(code.codeHash, vmOptions);
                backend = cache.get(code.codeHash, vmOptions);
                if (!backend.backend)
                {
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
                }
             });
      }

      ~ExecutionContextImpl()
      {
         transactionContext.blockContext.systemContext.wasmCache.impl->add(std::move(backend));
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
         auto& vmContext = backend.backend->get_context();
         const auto previousStack = vmContext.get_remaining_call_depth();
         auto restore = psio::finally{[&] {
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
      rhf_t::add<&ExecutionContextImpl::setMaxCpuTime>("env", "setMaxCpuTime");
      rhf_t::add<&ExecutionContextImpl::getCurrentAction>("env", "getCurrentAction");
      rhf_t::add<&ExecutionContextImpl::call>("env", "call");
      rhf_t::add<&ExecutionContextImpl::setRetval>("env", "setRetval");
      rhf_t::add<&ExecutionContextImpl::kvOpen>("env", "kvOpen");
      rhf_t::add<&ExecutionContextImpl::kvOpenAt>("env", "kvOpenAt");
      rhf_t::add<&ExecutionContextImpl::kvClose>("env", "kvClose");
      rhf_t::add<&ExecutionContextImpl::exportHandles>("env", "exportHandles");
      rhf_t::add<&ExecutionContextImpl::importHandles>("env", "importHandles");
      rhf_t::add<&ExecutionContextImpl::kvPut>("env", "kvPut");
      rhf_t::add<&ExecutionContextImpl::kvRemove>("env", "kvRemove");
      rhf_t::add<&ExecutionContextImpl::kvGet>("env", "kvGet");
      rhf_t::add<&ExecutionContextImpl::kvGreaterEqual>("env", "kvGreaterEqual");
      rhf_t::add<&ExecutionContextImpl::kvLessThan>("env", "kvLessThan");
      rhf_t::add<&ExecutionContextImpl::kvMax>("env", "kvMax");
      // rhf_t::add<&ExecutionContextImpl::kvGetTransactionUsage>("env", "kvGetTransactionUsage");
      rhf_t::add<&ExecutionContextImpl::checkoutSubjective>("env", "checkoutSubjective");
      rhf_t::add<&ExecutionContextImpl::commitSubjective>("env", "commitSubjective");
      rhf_t::add<&ExecutionContextImpl::abortSubjective>("env", "abortSubjective");
      rhf_t::add<&ExecutionContextImpl::socketOpen>("env", "socketOpen");
      rhf_t::add<&ExecutionContextImpl::socketSend>("env", "socketSend");
      rhf_t::add<&ExecutionContextImpl::socketSetFlags>("env", "socketSetFlags");
      rhf_t::add<&ExecutionContextImpl::readFile>("env", "readFile");
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
      impl->onTransferControl(callerFlags);
      auto cleanup = psio::finally{[&] { impl->onTransferControl(callerFlags); }};

      if ((callerFlags & (callerSudo | isLocal)) == callerSudo)
      {
         check((impl->code.flags & (isLocal | CodeRow::isReplacement)) != isLocal,
               "on-chain service cannot sudo when calling a node-local service");
      }

      impl->exec(actionContext, [&] {  //
         (*impl->backend.backend)(impl->getAltStack(), *impl, "env", "called",
                                  actionContext.action.service.value,
                                  actionContext.action.sender.value);
      });
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
