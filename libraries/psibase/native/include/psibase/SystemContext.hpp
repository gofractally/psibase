#pragma once

#include <psibase/ExecutionContext.hpp>
#include <psibase/db.hpp>

namespace psibase
{
   struct WatchdogManager;
   struct Sockets;

   struct SystemContext
   {
      SharedDatabase                   sharedDatabase;
      WasmCache                        wasmCache;
      std::vector<ExecutionMemory>     executionMemories;
      std::shared_ptr<WatchdogManager> watchdogManager;
      std::shared_ptr<Sockets>         sockets;

      void setNumMemories(size_t n)
      {
         if (n < executionMemories.size())
            executionMemories.resize(n);
         executionMemories.reserve(n);
         while (n > executionMemories.size())
            executionMemories.push_back({});
      }
   };  // SystemContext

   struct SharedStateImpl;
   struct SharedState
   {
      const std::unique_ptr<SharedStateImpl> impl;

      SharedState(SharedDatabase db, psibase::WasmCache wasmCache);
      ~SharedState();

      std::vector<std::span<const char>> dbSpan() const;
      std::vector<std::span<const char>> codeSpan() const;
      std::vector<std::span<const char>> linearMemorySpan() const;

      bool needGenesis() const;

      std::unique_ptr<SystemContext> getSystemContext();
      void                           addSystemContext(std::unique_ptr<SystemContext> context);
   };
}  // namespace psibase
