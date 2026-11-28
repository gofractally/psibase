#pragma once

#include <psibase/ExecutionContext.hpp>
#include <psibase/db.hpp>

namespace psibase
{
   struct WatchdogManager;
   struct Sockets;
   struct Mount;
   class FileStore;
   class UsageMeter;

   struct SystemContext
   {
      SharedDatabase                   sharedDatabase;
      WasmCache                        wasmCache;
      std::vector<ExecutionMemory>     executionMemories;
      std::shared_ptr<WatchdogManager> watchdogManager;
      std::shared_ptr<Sockets>         sockets;
      std::shared_ptr<Mount>           mountpoints;
      // Node-local usage metering (gofractally/psibase#2270). Null where
      // nothing meters (the tester); every measuring point checks.
      std::shared_ptr<UsageMeter> usage;
      // Plain files kept by node-local services (gofractally/psibase#2312).
      // Null where there is no place for them.
      std::shared_ptr<FileStore> files;

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

      std::filesystem::path databaseDirectory() const;
      std::vector<std::span<const char>> codeSpan() const;
      std::vector<std::span<const char>> linearMemorySpan() const;

      bool needGenesis() const;

      std::shared_ptr<Sockets> sockets();
      std::shared_ptr<Mount>   mountpoints();
      std::shared_ptr<UsageMeter> usage();
      std::shared_ptr<FileStore>  files();

      std::unique_ptr<SystemContext> getSystemContext();
      void                           addSystemContext(std::unique_ptr<SystemContext> context);
   };
}  // namespace psibase
