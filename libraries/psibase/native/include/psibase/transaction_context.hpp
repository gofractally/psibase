#pragma once

#include <psibase/block_context.hpp>

namespace psibase
{
   struct transaction_context
   {
      psibase::block_context&                    block_context;
      database::session                          session;
      const SignedTransaction&                   trx;
      psibase::transaction_trace&                transaction_trace;
      std::map<AccountNumber, execution_context> execution_contexts;
      int                                        call_depth = 0;

      transaction_context(psibase::block_context&     block_context,
                          const SignedTransaction&    trx,
                          psibase::transaction_trace& transaction_trace,
                          bool                        enable_undo);

      void exec_transaction();
      void exec_called_action(uint64_t caller_flags, const Action& act, ActionTrace& atrace);
      void exec_rpc(const Action& act, ActionTrace& atrace);

      execution_context& get_execution_context(AccountNumber contract);
   };  // transaction_context

}  // namespace psibase
