#pragma once

#include <psibase/block_context.hpp>

namespace psibase
{
   struct transaction_context
   {
      psibase::block_context&                  block_context;
      database::session                        session;
      const signed_transaction&                trx;
      const std::vector<eosio::public_key>&    recovered_keys;
      psibase::transaction_trace&              transaction_trace;
      std::map<account_num, execution_context> execution_contexts;
      int                                      call_depth = 0;

      transaction_context(psibase::block_context&               block_context,
                          const signed_transaction&             trx,
                          const std::vector<eosio::public_key>& recovered_keys,
                          psibase::transaction_trace&           transaction_trace,
                          bool                                  enable_undo);

      void exec_transaction();
      void exec_called_action(uint64_t caller_flags, const action& act, action_trace& atrace);
      void exec_rpc(const action& act, action_trace& atrace);

      execution_context& get_execution_context(account_num contract);
   };  // transaction_context

}  // namespace psibase
