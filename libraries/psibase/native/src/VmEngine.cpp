// ExecutionContext.hpp, implemented on top of whichever engines this build
// has. See VmEngine.hpp.

#include <psibase/VmEngine.hpp>

#include <psibase/BlockContext.hpp>
#include <psibase/TransactionContext.hpp>
#include <psibase/db.hpp>

#include <atomic>
#include <cstdlib>
#include <stdexcept>
#include <string>
#include <utility>

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
}  // namespace psibase::vm

namespace psibase
{
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

   struct WasmCacheImpl
   {
      const vm::Engine*          engine;
      std::shared_ptr<vm::Cache> cache;
   };

   WasmCache::WasmCache(uint32_t cacheSize, const std::filesystem::path& nativeArtifactPath)
   {
      auto& engine = vm::selected();
      impl         = std::make_shared<WasmCacheImpl>(
          WasmCacheImpl{&engine, engine.makeCache(cacheSize, nativeArtifactPath)});
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
      impl->cache->finishCompiles();
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
