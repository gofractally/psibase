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
      psibase::block_context&               block_context;
      database::session                     session;
      const SignedTransaction&              trx;
      TransactionTrace&                     transaction_trace;
      KvResourceMap                         kvResourceDeltas;
      int                                   call_depth = 0;
      std::chrono::steady_clock::time_point start_time;
      std::chrono::steady_clock::duration   contract_load_time{0};

      transaction_context(psibase::block_context&  block_context,
                          const SignedTransaction& trx,
                          TransactionTrace&        transaction_trace,
                          bool                     enable_undo);

      void exec_transaction();
      void exec_called_action(uint64_t caller_flags, const Action& act, ActionTrace& atrace);
      void exec_rpc(const Action& act, ActionTrace& atrace);

      execution_context& get_execution_context(AccountNumber contract);

      // Cancel execution of all execution_contexts because of timeout; may be called from another thread
      void async_timeout();

     private:
      std::mutex                                 ec_mutex;
      bool                                       ec_canceled = false;
      std::map<AccountNumber, execution_context> execution_contexts;
   };  // transaction_context

}  // namespace psibase
