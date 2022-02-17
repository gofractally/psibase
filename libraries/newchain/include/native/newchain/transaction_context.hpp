#pragma once

#include <newchain/block_context.hpp>

namespace newchain
{
   struct transaction_context
   {
      newchain::block_context&                 block_context;
      chainbase::database::session             db_session;
      const signed_transaction&                trx;
      const std::vector<eosio::public_key>&    recovered_keys;
      newchain::transaction_trace&             transaction_trace;
      std::map<account_num, execution_context> execution_contexts;

      transaction_context(newchain::block_context&              block_context,
                          const signed_transaction&             trx,
                          const std::vector<eosio::public_key>& recovered_keys,
                          newchain::transaction_trace&          transaction_trace,
                          bool                                  enable_undo);

      void exec();
      void exec_action(const action& act);

      execution_context& get_execution_context(account_num contract);
   };  // transaction_context

}  // namespace newchain
