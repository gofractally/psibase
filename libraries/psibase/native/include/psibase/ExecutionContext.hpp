#pragma once

#include <psibase/block.hpp>

namespace psibase
{
   struct Database;
   struct VMOptions;

   // Only useful for genesis
   void setCode(Database&          db,
                AccountNumber      contract,
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
   };

   struct ExecutionMemoryImpl;
   struct ExecutionMemory
   {
      std::unique_ptr<ExecutionMemoryImpl> impl;

      ExecutionMemory();
      ExecutionMemory(ExecutionMemory&&);
      ~ExecutionMemory();
   };

   struct TransactionContext;
   struct ActionContext;

   struct TimeoutException : std::exception
   {
      const char* what() const noexcept override { return "transaction timed out"; }
   };

   struct ExecutionContextImpl;
   struct ExecutionContext
   {
      std::unique_ptr<ExecutionContextImpl> impl;

      ExecutionContext(TransactionContext& transactionContext,
                       const VMOptions&    vmOptions,
                       ExecutionMemory&    memory,
                       AccountNumber       contract);
      ExecutionContext(ExecutionContext&&);
      ~ExecutionContext();

      static void registerHostFunctions();

      void execProcessTransaction(ActionContext& actionContext);
      void execCalled(uint64_t callerFlags, ActionContext& actionContext);
      void execVerify(ActionContext& actionContext);
      void execServe(ActionContext& actionContext);

      // Cancel execution because of timeout; may be called from another thread
      void asyncTimeout();
   };

}  // namespace psibase
