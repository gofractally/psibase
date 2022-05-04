#pragma once

#include <psibase/BlockContext.hpp>

#include <boost/container/flat_map.hpp>
#include <chrono>
#include <mutex>

namespace psibase
{
   using KvResourceMap = boost::container::flat_map<KvResourceKey,
                                                    KvResourceDelta,
                                                    std::less<KvResourceKey>,
                                                    std::vector<KvResourcePair>>;

   struct transaction_context
   {
      psibase::BlockContext&                blockContext;
      Database::Session                     session;
      const SignedTransaction&              trx;
      TransactionTrace&                     transaction_trace;
      KvResourceMap                         kvResourceDeltas;
      int                                   call_depth = 0;
      std::chrono::steady_clock::time_point start_time;
      std::chrono::steady_clock::duration   contract_load_time{0};

      transaction_context(psibase::BlockContext&   blockContext,
                          const SignedTransaction& trx,
                          TransactionTrace&        transaction_trace,
                          bool                     enableUndo);

      void exec_transaction();
      void exec_called_action(uint64_t callerFlags, const Action& act, ActionTrace& atrace);
      void execServe(const Action& act, ActionTrace& atrace);

      ExecutionContext& get_execution_context(AccountNumber contract);

      // Cancel execution of all execution_contexts because of timeout; may be called from another thread
      void asyncTimeout();

     private:
      std::mutex                                ec_mutex;
      bool                                      ec_canceled = false;
      std::map<AccountNumber, ExecutionContext> execution_contexts;
   };  // transaction_context

}  // namespace psibase
