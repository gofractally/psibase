#pragma once

#include <cstddef>
#include <memory>

namespace psibase
{
   struct SharedState;

   class RunQueue
   {
     public:
      explicit RunQueue(std::shared_ptr<SharedState>);
      ~RunQueue();
      // Tell any thread pools to check for rows to execute
      void notify();

     private:
      struct Impl;
      friend class WasmThreadPool;
      std::unique_ptr<Impl> impl;
   };

   class WasmThreadPool
   {
     public:
      WasmThreadPool(RunQueue& queue, std::size_t numThreads);
      ~WasmThreadPool();
      void setNumThreads(std::size_t numThreads);

     private:
      struct Impl;
      std::unique_ptr<Impl> impl;
   };
}  // namespace psibase
