#pragma once

#include <newchain/block_context.hpp>

namespace newchain
{
   struct transaction_context
   {
      newchain::block_context&                 block_context;
      mdbx::txn_managed*                       kv_trx;
      mdbx::txn_managed                        nested_kv_trx;
      const signed_transaction&                trx;
      const std::vector<eosio::public_key>&    recovered_keys;
      newchain::transaction_trace&             transaction_trace;
      std::map<account_num, execution_context> execution_contexts;
      int                                      call_depth = 0;

      transaction_context(newchain::block_context&              block_context,
                          const signed_transaction&             trx,
                          const std::vector<eosio::public_key>& recovered_keys,
                          newchain::transaction_trace&          transaction_trace,
                          bool                                  enable_undo);

      void exec_transaction();
      void exec_called_action(const action& act, action_trace& atrace);

      execution_context& get_execution_context(account_num contract);
   };  // transaction_context

}  // namespace newchain
