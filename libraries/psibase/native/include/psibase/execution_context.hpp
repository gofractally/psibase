#pragma once

#include <psibase/block.hpp>

namespace mdbx
{
   class txn_managed;
}

namespace psibase
{
   struct database;

   // Only useful for genesis
   void set_code(database&           db,
                 account_num         contract,
                 uint8_t             vm_type,
                 uint8_t             vm_version,
                 eosio::input_stream code);

   struct wasm_cache_impl;
   struct wasm_cache
   {
      std::shared_ptr<wasm_cache_impl> impl;

      wasm_cache(uint32_t cache_size);
      wasm_cache(const wasm_cache&);
      wasm_cache(wasm_cache&&);
      ~wasm_cache();
   };

   struct execution_memory_impl;
   struct execution_memory
   {
      std::unique_ptr<execution_memory_impl> impl;

      execution_memory();
      execution_memory(execution_memory&&);
      ~execution_memory();
   };

   struct transaction_context;
   struct action_context;

   struct execution_context_impl;
   struct execution_context
   {
      std::unique_ptr<execution_context_impl> impl;

      execution_context(transaction_context& trx_context,
                        execution_memory&    memory,
                        account_num          contract);
      execution_context(execution_context&&);
      ~execution_context();

      static void register_host_functions();

      void exec_process_transaction(action_context& act_context);
      void exec_called(uint64_t caller_flags, action_context& act_context);
      void exec_verify(action_context& act_context);
      void exec_rpc(action_context& act_context);
   };

}  // namespace psibase
