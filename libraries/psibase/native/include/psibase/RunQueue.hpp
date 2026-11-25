#pragma once

#include <cstddef>
#include <chrono>
#include <memory>
#include <optional>

namespace psibase
{
   struct SharedState;

   class RunQueue
   {
     public:
      // Operator policy for asynchronous context-free proof admission only.
      explicit RunQueue(std::shared_ptr<SharedState>,
                        std::optional<std::chrono::microseconds> proofTimeout = std::nullopt);
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
