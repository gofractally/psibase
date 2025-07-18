#pragma once

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
                psio::input_stream code);

   struct WasmCacheImpl;
   struct WasmCache
   {
      std::shared_ptr<WasmCacheImpl> impl;

      WasmCache(uint32_t cacheSize);
      WasmCache(const WasmCache&);
      WasmCache(WasmCache&&);
      ~WasmCache();

      std::vector<std::span<const char>> span() const;
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
