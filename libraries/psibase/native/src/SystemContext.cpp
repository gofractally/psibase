#include <psibase/ActionContext.hpp>
#include <psibase/Watchdog.hpp>

#include <mutex>

namespace psibase
{
   struct SharedStateImpl
   {
      // TODO: need to redo cache since numExecutionMemories varies
      std::mutex                                  mutex;
      SharedDatabase                              db;
      WasmCache                                   wasmCache;
      std::vector<std::unique_ptr<SystemContext>> systemContextCache;
      std::shared_ptr<WatchdogManager>            watchdogManager;

      // TODO: This assumes that systemContexts are always returned to the cache
      std::vector<SystemContext*> allSystemContexts;

      SharedStateImpl(SharedDatabase db, WasmCache wasmCache)
          : db{std::move(db)},
            wasmCache{std::move(wasmCache)},
            watchdogManager(std::make_shared<WatchdogManager>())
      {
      }
   };

   SharedState::SharedState(SharedDatabase db, WasmCache wasmCache)
       : impl{std::make_unique<SharedStateImpl>(std::move(db), std::move(wasmCache))}
   {
   }

   SharedState::~SharedState() {}

   std::vector<std::span<const char>> SharedState::dbSpan() const
   {
      return impl->db.span();
   }

   std::vector<std::span<const char>> SharedState::codeSpan() const
   {
      return impl->wasmCache.span();
   }

   std::vector<std::span<const char>> SharedState::linearMemorySpan() const
   {
      std::lock_guard                    lock{impl->mutex};
      std::vector<std::span<const char>> result;
      for (auto* ctx : impl->allSystemContexts)
      {
         for (const auto& memory : ctx->executionMemories)
         {
            result.push_back(memory.span());
         }
      }
      return result;
   }

   bool SharedState::needGenesis() const
   {
      auto sharedDb = [&]
      {
         std::lock_guard<std::mutex> lock{impl->mutex};
         return impl->db;
      }();
      auto     head = sharedDb.getHead();
      Database db{std::move(sharedDb), std::move(head)};
      auto     session = db.startRead();
      if (auto status = db.kvGet<StatusRow>(StatusRow::db, statusKey()))
      {
         if (status->head)
         {
            return false;
         }
      }
      return true;
   }

   std::unique_ptr<SystemContext> SharedState::getSystemContext()
   {
      std::lock_guard<std::mutex> lock{impl->mutex};
      if (impl->systemContextCache.empty())
      {
         auto result = std::make_unique<SystemContext>(
             SystemContext{impl->db, impl->wasmCache, {}, impl->watchdogManager});
         impl->allSystemContexts.push_back(result.get());
         return result;
      }
      auto result = std::move(impl->systemContextCache.back());
      impl->systemContextCache.pop_back();
      return result;
   }

   void SharedState::addSystemContext(std::unique_ptr<SystemContext> context)
   {
      std::lock_guard<std::mutex> lock{impl->mutex};
      impl->systemContextCache.push_back(std::move(context));
   }
}  // namespace psibase
