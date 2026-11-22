#pragma once

// The seam between the node and its execution engines.
//
// ExecutionContext.hpp is what the rest of the node uses. Each engine adapter
// implements the interfaces below instead, and exports one Engine. A build has
// one engine (PSIBASE_VM_BACKEND=JIT2, WASMTIME, ...) or several
// (PSIBASE_VM_BACKEND=DYNAMIC), in which case one is selected when the process
// starts. Which engine runs is a property of the node, never of the chain:
// every engine must compute the same results.

#include <psibase/ExecutionContext.hpp>

#include <filesystem>
#include <memory>
#include <span>
#include <string_view>
#include <vector>

namespace psibase::vm
{
   // Compiled services, shared by the transactions of one SystemContext.
   struct Cache
   {
      virtual ~Cache() = default;
      virtual std::vector<std::span<const char>> span() const = 0;
      virtual void compileAhead(const Checksum256&    hash,
                                std::span<const char> code,
                                const VMOptions&      options,
                                std::uint8_t          vmVersion) = 0;
   };

   // What one running service needs for its linear memory, if the engine
   // keeps that outside the instance.
   struct Memory
   {
      virtual ~Memory() = default;
      virtual std::span<const char> span() const = 0;
   };

   // One service executing within one transaction.
   struct Context
   {
      virtual ~Context() = default;
      // The ExecutionContext that owns this was constructed or moved.
      virtual void          rebind(ExecutionContext* self) = 0;
      virtual std::uint32_t remainingStack() const = 0;
      virtual void          execProcessTransaction(ActionContext& actionContext) = 0;
      virtual void          execCalled(uint64_t callerFlags, ActionContext& actionContext) = 0;
      virtual void          execServe(ActionContext& actionContext) = 0;
      virtual void          exec(ActionContext& actionContext, std::string_view fn) = 0;
      // May be called from another thread.
      virtual void asyncTimeout() = 0;
   };

   struct Engine
   {
      std::string_view name;
      void (*registerHostFunctions)();
      std::shared_ptr<Cache> (*makeCache)(std::uint32_t                cacheSize,
                                          const std::filesystem::path& nativeArtifactPath);
      std::unique_ptr<Memory> (*makeMemory)();
      // memory and cache are ones this engine made.
      std::unique_ptr<Context> (*makeContext)(TransactionContext& transactionContext,
                                              const VMOptions&    vmOptions,
                                              Memory&             memory,
                                              Cache&              cache,
                                              AccountNumber       service);
   };

   // The engines in this build. The first is the default.
   std::span<const Engine* const> engines();

   // The engine new WasmCaches (and so new SystemContexts) will use. Initially
   // the one named by the PSIBASE_VM_ENGINE environment variable, or the
   // default.
   const Engine& selected();

   // Selects an engine by name. Throws if this build does not have it. Affects
   // WasmCaches created afterwards; existing ones keep the engine they have.
   void select(std::string_view name);

   // The engine a WasmCache was created with.
   const Engine& engineOf(const WasmCache& cache);
}  // namespace psibase::vm
