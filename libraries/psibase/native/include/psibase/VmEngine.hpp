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

#include <algorithm>
#include <chrono>
#include <cstddef>
#include <deque>
#include <filesystem>
#include <functional>
#include <memory>
#include <optional>
#include <span>
#include <string_view>
#include <vector>

namespace psibase
{
   class NativeAotCache;
}

namespace psibase::vm
{
   // The code an engine's cache has found its compiler to refuse: what
   // Cache::refused answers from. Bounded, oldest first out. Not
   // synchronized: used under the cache's own mutex.
   template <typename Key>
   struct RefusedCode
   {
      static constexpr std::size_t maxKeys = 1024;
      std::deque<Key>              keys;

      bool contains(const Key& key) const { return std::ranges::find(keys, key) != keys.end(); }
      void record(const Key& key)
      {
         if (contains(key))
            return;
         keys.push_back(key);
         if (keys.size() > maxKeys)
            keys.pop_front();
      }
      void erase(const Key& key) { std::erase(keys, key); }
   };

   // Compiled services, shared by the transactions of one SystemContext.
   struct Cache
   {
      virtual ~Cache() = default;
      virtual std::vector<std::span<const char>> span() const = 0;
      virtual void compileAhead(const Checksum256&    hash,
                                std::span<const char> code,
                                const VMOptions&      options,
                                std::uint8_t          vmVersion) = 0;
      // Returns once every compile compileAhead started has finished. An
      // engine that compiles nothing in the background has nothing to wait for.
      virtual void finishCompiles() {}
      // See WasmCache.
      virtual bool contains(const Checksum256&, const VMOptions&, std::uint8_t) const
      {
         return false;
      }
      virtual WasmCacheStats stats() const { return {}; }
      // Whether a compile of this code that compileAhead ran or started has
      // ended without a module, and none has been made since: this node's
      // compiler refuses the code (or its compile threads leave it to the
      // first execution), so waiting for another compile would never end.
      // The engine records this where the compile ends; it is never
      // inferred from the module being absent, which is also true of a
      // module that was compiled and has since been evicted
      // (WasmCache::mustDefer).
      virtual bool refused(const Checksum256&, const VMOptions&, std::uint8_t) const
      {
         return false;
      }

      // What WasmCache needs to apply the node's rule for when code is
      // compiled (WasmCache::compileInBackground, gofractally/psibase#2256).
      // The rule itself is not the engine's.
      //
      // Whether compileAhead returns before the code is compiled, because
      // the engine compiles on threads of its own. If it does not, WasmCache
      // runs compileAhead on its compile threads where the rule says the
      // caller must not wait.
      virtual bool compilesInBackground() const { return false; }
      // For an engine that compiles in the background: returns true once no
      // compile of this code is queued or running, false if one still is
      // after `limit`. Without a limit it waits as long as it takes.
      virtual bool awaitCompile(const Checksum256&,
                                const VMOptions&,
                                std::uint8_t,
                                std::optional<std::chrono::nanoseconds> limit)
      {
         (void)limit;
         return true;
      }
      // For an engine that compiles in the background: compiles queued or
      // running.
      virtual std::size_t compilesInFlight() const { return 0; }

      // Tests only: called on the thread that is about to compile a module
      // from wasm, by engines that report compiles (wasmtime). Set before the
      // cache is used.
      std::function<void(const Checksum256&)> compileHook;
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
      // artifacts: where compiled modules are kept between runs; if null,
      // the cache a process that configures none uses.
      std::shared_ptr<Cache> (*makeCache)(std::uint32_t                   cacheSize,
                                          std::shared_ptr<NativeAotCache> artifacts);
      std::unique_ptr<Memory> (*makeMemory)();
      // memory and cache are ones this engine made.
      std::unique_ptr<Context> (*makeContext)(TransactionContext& transactionContext,
                                              const VMOptions&    vmOptions,
                                              Memory&             memory,
                                              Cache&              cache,
                                              AccountNumber       service);
      // Whether the engine can run services with debugging support (see
      // serviceDebugging). Its caches read that setting when they are made.
      bool serviceDebugging = false;
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

   // Whether services run with debugging support: when a service fails, the
   // node logs where in the service it was, and compiled services are
   // registered with a debugger attached to the node (gdb, lldb). Off unless
   // the node's operator turns it on, initially through the
   // PSIBASE_DEBUG_SERVICES environment variable. Like the engine, this is a
   // property of the node and never of the chain: a node that debugs computes
   // exactly what one that does not computes, and nothing it adds reaches a
   // block, the state or a transaction trace.
   bool serviceDebugging();

   // Affects WasmCaches created afterwards; existing ones keep what they
   // have. Creating a WasmCache then throws if the selected engine has no
   // debugging support.
   void setServiceDebugging(bool enabled);

   // The engine a WasmCache was created with.
   const Engine& engineOf(const WasmCache& cache);
}  // namespace psibase::vm
