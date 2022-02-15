#pragma once

#include <newchain/block.hpp>

namespace newchain
{
   void set_code(database&           db,
                 account_num         contract,
                 uint8_t             vm_type,
                 uint8_t             vm_version,
                 eosio::input_stream code);

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

      void exec(action_context& act_context);
   };

}  // namespace newchain
