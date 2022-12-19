#include <psibase/ActionContext.hpp>

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

      // TODO: This assumes that systemContexts are always returned to the cache
      std::vector<SystemContext*> allSystemContexts;

      SharedStateImpl(SharedDatabase db, WasmCache wasmCache)
          : db{std::move(db)}, wasmCache{std::move(wasmCache)}
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

   std::unique_ptr<SystemContext> SharedState::getSystemContext()
   {
      std::lock_guard<std::mutex> lock{impl->mutex};
      if (impl->systemContextCache.empty())
      {
         auto result = std::make_unique<SystemContext>(SystemContext{impl->db, impl->wasmCache});
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
