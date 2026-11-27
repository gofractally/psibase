#pragma once
#include <chrono>
#include <cstddef>
#include <filesystem>
#include <functional>
#include <memory>
#include <optional>
#include <span>
#include <vector>

#include <psibase/block.hpp>
#include <psibase/nativeTables.hpp>

namespace psibase
{
   struct Database;
   struct VMOptions;

   // Only useful for genesis
   void setCode(Database&          db,
                AccountNumber      service,
                uint8_t            vmType,
                uint8_t            vmVersion,
                std::span<const char> code);

   /// What a WasmCache has done since it was created.
   struct WasmCacheStats
   {
      std::uint64_t compiled  = 0;  ///< modules compiled from wasm
      std::uint64_t loaded    = 0;  ///< modules taken from the artifact store
      std::uint64_t discarded = 0;  ///< stored artifacts that failed verification
      /// Of `compiled` and of `loaded`, the modules that do not fit a slot of
      /// the engine's instance pool and were taken by the engine without one
      /// (wasmtime; gofractally/psibase#2272).
      std::uint64_t compiledPoolless = 0;
      std::uint64_t loadedPoolless   = 0;
      /// Compiles that were abandoned in the compiler: a speculative run's,
      /// when the node's bound on it passed or the node stopped
      /// (gofractally/psibase#2267). Not in `compiled`. Counted by engines
      /// whose compiler can be stopped (wasmtime); 0 otherwise.
      std::uint64_t compilesAbandoned = 0;
      /// Speculative runs that were failed at once because a compile of the
      /// code they needed had just been abandoned at the bound
      /// (WasmCache::speculativeCompileRetry).
      std::uint64_t compilesNotRetried = 0;
   };

   class NativeAotCache;
   struct WasmCacheImpl;
   namespace vm
   {
      struct Cache;
      struct Engine;
   }  // namespace vm
   struct WasmCache
   {
      std::shared_ptr<WasmCacheImpl> impl;

      /// Compiled modules are kept between runs in the directory
      /// `nativeArtifactPath`; if it is empty, where a process that
      /// configures nothing keeps them (nativeAotCacheFromEnvironment).
      WasmCache(uint32_t cacheSize, const std::filesystem::path& nativeArtifactPath = {});
      /// Compiled modules are kept between runs in `artifacts`.
      WasmCache(uint32_t cacheSize, std::shared_ptr<NativeAotCache> artifacts);
      /// Tests only: the node's rule over an engine cache the caller made.
      WasmCache(const vm::Engine& engine, std::shared_ptr<vm::Cache> cache);
      WasmCache(const WasmCache&);
      WasmCache(WasmCache&&);
      ~WasmCache();

      std::vector<std::span<const char>> span() const;

      /// Newly stored code: make it ready for the transaction that first
      /// executes it. wasmtime compiles here, before returning (or loads the
      /// stored artifact); LLVM AOT starts a compile in the background. Never
      /// throws: code that cannot be compiled is logged and is reported again
      /// by whatever executes it first.
      void compileAhead(const Checksum256&    hash,
                        std::span<const char> code,
                        const VMOptions&      options,
                        std::uint8_t          vmVersion);
      /// Returns once every compile started by compileAhead has finished.
      void finishCompiles();

      /// Whether the compiled module is in memory, ready to execute. Reported
      /// by engines that share compiled modules (wasmtime); false otherwise.
      bool           contains(const Checksum256& hash,
                              const VMOptions&   options,
                              std::uint8_t       vmVersion) const;
      WasmCacheStats stats() const;

      // When code is compiled, by what the node is doing (TransactionContext
      // applies this; gofractally/psibase#2256). The same on every engine;
      // only how long a compile takes differs.
      //
      //  - A speculative run compiles what it needs, on a compile thread, and
      //    waits for it. The compile is bounded by speculativeCompileWait(),
      //    counted from the moment it was started: when that passes the
      //    compile is abandoned (gofractally/psibase#2267) and every run
      //    waiting for it is given up. Nothing is kept of an abandoned
      //    compile, and it is no refusal: a block compiles the code to
      //    completion all the same.
      //
      //    This makes the bound a hard limit on what this node runs
      //    speculatively. Before compiles could be stopped, a run gave up
      //    and the compile finished, so that the transaction sent again
      //    found the module. Now code that this machine, under its present
      //    load, does not compile within the bound is abandoned at every
      //    attempt: it never passes a speculative run here, so this node
      //    never puts a transaction that deploys or calls it uncompiled into
      //    a block it produces (it still applies such a block made by
      //    another producer). The limit depends on the machine; the operator
      //    raises it with PSIBASE_SPECULATIVE_COMPILE_MS.
      //
      //    So that such code does not occupy a compile thread for the bound
      //    at every attempt, the node remembers for speculativeCompileRetry()
      //    that it abandoned the compile, and fails a run that needs the
      //    code at once. That memory is not a refusal either: it is not
      //    stored, and it goes when its time is up, when the bound is raised
      //    above the one the compile was abandoned at, and when a block (or
      //    anything else that compiles to completion) asks for the code.
      //  - A block producer running a transaction from its queue never
      //    compiles and never waits for a compile: if the module is missing
      //    the transaction is not in this block (mustDefer).
      //  - A node applying a block starts the compile and goes on; whatever
      //    executes the code first waits for it. Such a compile is never
      //    abandoned, however long it takes: if a speculative run's compile
      //    of the same code is in flight it is no longer bounded from then
      //    on, and if it was abandoned already it is run again.
      //  - Everything else (boot, the tester, callbacks, queries, signature
      //    verification) compiles where it needs the module, as before.
      //
      // Compiles in flight are counted, and a speculative run that would
      // start one beyond maxSpeculativeCompiles is refused. An abandoned
      // compile counts until its thread has returned from the compiler,
      // which is soon after but not at once.
      //
      // An engine whose compiler cannot be stopped (LLVM AOT) is the same
      // except that a compile whose bound has passed runs on to its end,
      // counted until then, and a later run finds the module.
      static constexpr std::size_t maxSpeculativeCompiles = 4;
      enum class CompileStart
      {
         ready,     ///< the module is in memory; nothing was started
         started,   ///< this call started a compile of the code
         inFlight,  ///< a compile of this code was queued or running already
         full,      ///< not started: maxSpeculativeCompiles are already in flight
         /// not started: a compile of the code was abandoned at the bound
         /// less than speculativeCompileRetry() ago
         notRetried,
      };
      /// Starts compiling the code on another thread, unless it is compiled
      /// or being compiled already, and returns. For what must have the
      /// module: the compile runs to completion.
      CompileStart compileInBackground(const Checksum256&    hash,
                                       std::span<const char> code,
                                       const VMOptions&      options,
                                       std::uint8_t          vmVersion);
      enum class CompileWait
      {
         finished,   ///< no compile of the code is in flight any more
         inFlight,   ///< one still is, and goes on
         abandoned,  ///< its bound passed and it was stopped; there is no module
      };
      /// What the node remembers of a compile it abandoned at the bound.
      struct CompileNotRetried
      {
         std::chrono::nanoseconds              bound;  ///< the bound it did not compile within
         std::chrono::system_clock::time_point at;     ///< when it was abandoned
         std::chrono::system_clock::time_point until;  ///< when it is compiled again
         std::chrono::steady_clock::time_point expires;  ///< `until`, on the clock that decides
      };
      struct SpeculativeCompile
      {
         CompileStart start;
         /// If nothing was started: `inFlight` for `full`, `abandoned` for
         /// `notRetried`.
         CompileWait wait;
         /// Set for `notRetried`.
         std::optional<CompileNotRetried> notRetried = {};
      };
      /// For a speculative run: starts a compile of the code unless one is
      /// in flight (or maxSpeculativeCompiles are: `full`), and waits for it
      /// for at most speculativeCompileWait().
      SpeculativeCompile compileForSpeculativeRun(const Checksum256&    hash,
                                                  std::span<const char> code,
                                                  const VMOptions&      options,
                                                  std::uint8_t          vmVersion);
      /// Returns true once no compile of this code is in flight; false if
      /// one still is after `limit`. Without a limit, waits, and the compile
      /// waited for is one that runs to completion.
      bool awaitCompile(const Checksum256&                      hash,
                        const VMOptions&                        options,
                        std::uint8_t                            vmVersion,
                        std::optional<std::chrono::nanoseconds> limit = {});
      /// For a block producer about to need this code in a transaction from
      /// its queue: true if the transaction must wait for a later block
      /// because the module is not compiled. A compile is then in flight
      /// (started here if none was). False if the module is there, or if
      /// the engine reports that a compile of it ended without one
      /// (vm::Cache::refused): the compiler refuses the code, which whatever
      /// executes it reports.
      bool mustDefer(const Checksum256&                           hash,
                     const std::function<std::span<const char>()>& code,
                     const VMOptions&                             options,
                     std::uint8_t                                 vmVersion);

      /// How long a speculative run's compile may take, and how long a run
      /// waits for one. Node-local: 5 s, or PSIBASE_SPECULATIVE_COMPILE_MS
      /// milliseconds.
      std::chrono::nanoseconds speculativeCompileWait() const;
      void                     setSpeculativeCompileWait(std::chrono::nanoseconds limit);
      /// For how long code whose compile was abandoned at the bound is not
      /// compiled again for a speculative run: a run that needs it fails at
      /// once, and its failure is nobody's compile time. Node-local: 10
      /// minutes, or PSIBASE_SPECULATIVE_COMPILE_RETRY_MS milliseconds; 0
      /// turns it off (every run compiles again, for the bound).
      std::chrono::nanoseconds speculativeCompileRetry() const;
      void                     setSpeculativeCompileRetry(std::chrono::nanoseconds period);

      /// For a node that is stopping: abandons, now, every compile in flight
      /// that a speculative run started, as if its bound had passed. The
      /// runs waiting for them are given up at once. Compiles a block needs
      /// are not touched, including one a speculative run started and a
      /// block has since come to need; the runs waiting for those stop
      /// waiting all the same. Destroying the last copy of the cache does the
      /// same before it waits for the compile threads.
      void abandonSpeculativeCompiles();

      /// Called, on a compile thread, each time the compiles started by
      /// compileInBackground have all finished: the moment a producer's
      /// deferred transactions can go ahead. Not called by an engine that
      /// compiles on threads of its own (LLVM AOT); there a deferred
      /// transaction waits for the next block. Clearing it returns once no
      /// call is in progress.
      void onCompilesFinished(std::function<void()> callback);

      /// Tests only: called on the thread about to compile a module from
      /// wasm, by engines that report compiles (wasmtime). Set before use.
      void setCompileHook(std::function<void(const Checksum256&)> hook);
   };

   struct ExecutionMemoryImpl;
   struct ExecutionMemory
   {
      std::unique_ptr<ExecutionMemoryImpl> impl;

      ExecutionMemory();
      ExecutionMemory(ExecutionMemory&&);
      ~ExecutionMemory();

      std::span<const char> span() const;
   };

   struct TransactionContext;
   struct ActionContext;

   struct TimeoutException : std::exception
   {
      const char* what() const noexcept override { return "transaction timed out"; }
   };

   struct DbMode
   {
      bool isSubjective;
      bool isSync;
      bool sockets;
      bool verifyOnly;
      // If true, a write session for the database is not required
      constexpr bool          isReadOnly() const { return !isSubjective && !isSync && !sockets; }
      static constexpr DbMode transaction() { return {false, true, true, false}; }
      static constexpr DbMode speculative() { return {false, true, false, false}; }
      static constexpr DbMode verify() { return {false, false, false, true}; }
      static constexpr DbMode callback() { return {true, true, true, false}; }
      static constexpr DbMode rpc() { return {true, false, true, false}; }
      static constexpr DbMode from(RunMode mode)
      {
         switch (mode)
         {
            case RunMode::verify:
               return DbMode::verify();
            case RunMode::speculative:
               return DbMode::speculative();
            case RunMode::rpc:
               return DbMode::rpc();
            case RunMode::callback:
               return DbMode::callback();
            default:
               throw std::runtime_error("Unknown RunMode");
         }
      }
   };

   struct ExecutionContextImpl;
   struct ExecutionContext
   {
      std::unique_ptr<ExecutionContextImpl> impl;

      ExecutionContext(TransactionContext& transactionContext,
                       const VMOptions&    vmOptions,
                       ExecutionMemory&    memory,
                       AccountNumber       service);
      ExecutionContext(ExecutionContext&&);
      ~ExecutionContext();

      static constexpr auto callerSudo = static_cast<std::uint64_t>(1) << 62;
      static constexpr auto isLocal    = static_cast<std::uint64_t>(1) << 63;
      static_assert(((callerSudo | isLocal) & CodeRow::allFlags) == 0);

      static void registerHostFunctions();

      std::uint32_t remainingStack() const;

      void execProcessTransaction(ActionContext& actionContext);
      void execCalled(uint64_t callerFlags, ActionContext& actionContext);
      void execServe(ActionContext& actionContext);
      void exec(ActionContext& actionContext, std::string_view fn);

      // Cancel execution because of timeout; may be called from another thread
      void asyncTimeout();
   };

}  // namespace psibase
