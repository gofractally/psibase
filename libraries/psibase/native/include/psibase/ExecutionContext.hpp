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
   };

   class NativeAotCache;
   struct WasmCacheImpl;
   struct WasmCache
   {
      std::shared_ptr<WasmCacheImpl> impl;

      /// Compiled modules are kept between runs in the directory
      /// `nativeArtifactPath`; if it is empty, where a process that
      /// configures nothing keeps them (nativeAotCacheFromEnvironment).
      WasmCache(uint32_t cacheSize, const std::filesystem::path& nativeArtifactPath = {});
      /// Compiled modules are kept between runs in `artifacts`.
      WasmCache(uint32_t cacheSize, std::shared_ptr<NativeAotCache> artifacts);
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
      //  - A speculative run compiles what it needs and waits for it, for at
      //    most speculativeCompileWait(). Then the run is given up and the
      //    compile runs on, so a retry finds the module.
      //  - A block producer running a transaction from its queue never
      //    compiles and never waits for a compile: if the module is missing
      //    the transaction is not in this block (mustDefer).
      //  - A node applying a block starts the compile and goes on; whatever
      //    executes the code first waits for it.
      //  - Everything else (boot, the tester, callbacks, queries, signature
      //    verification) compiles where it needs the module, as before.
      //
      // A thread that is compiling is never stopped. Compiles in flight are
      // counted, and a speculative run that would start one beyond
      // maxSpeculativeCompiles is refused.
      static constexpr std::size_t maxSpeculativeCompiles = 4;
      enum class CompileStart
      {
         ready,     ///< the module is in memory; nothing was started
         started,   ///< this call started a compile of the code
         inFlight,  ///< a compile of this code was queued or running already
         full,      ///< not started: `cap` compiles are already in flight
      };
      /// Starts compiling the code on another thread, unless it is compiled
      /// or being compiled already, and returns. With a cap, starts nothing
      /// if that many compiles are in flight.
      CompileStart compileInBackground(const Checksum256&         hash,
                                       std::span<const char>      code,
                                       const VMOptions&           options,
                                       std::uint8_t               vmVersion,
                                       std::optional<std::size_t> cap = {});
      /// Returns true once no compile of this code is in flight; false if
      /// one still is after `limit`. Without a limit, waits.
      bool awaitCompile(const Checksum256&                      hash,
                        const VMOptions&                        options,
                        std::uint8_t                            vmVersion,
                        std::optional<std::chrono::nanoseconds> limit = {});
      /// For a block producer about to need this code in a transaction from
      /// its queue: true if the transaction must wait for a later block
      /// because the module is not compiled. A compile is then in flight
      /// (started here if none was). False if the module is there, or if a
      /// compile started here has ended without leaving one: the compiler
      /// refuses the code, which whatever executes it reports.
      bool mustDefer(const Checksum256&                           hash,
                     const std::function<std::span<const char>()>& code,
                     const VMOptions&                             options,
                     std::uint8_t                                 vmVersion);

      /// How long a speculative run waits for a compile. Node-local: 5 s, or
      /// PSIBASE_SPECULATIVE_COMPILE_MS milliseconds.
      std::chrono::nanoseconds speculativeCompileWait() const;
      void                     setSpeculativeCompileWait(std::chrono::nanoseconds limit);

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
