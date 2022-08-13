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

   std::unique_ptr<SystemContext> SharedState::getSystemContext()
   {
      std::lock_guard<std::mutex> lock{impl->mutex};
      if (impl->systemContextCache.empty())
         return std::make_unique<SystemContext>(SystemContext{impl->db, impl->wasmCache});
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
