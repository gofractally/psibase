#pragma once

#include <boost/container/flat_map.hpp>
#include <psibase/BlockContext.hpp>

namespace psibase
{
   using KvResourceMap = boost::container::flat_map<KvResourceKey,
                                                    KvResourceDelta,
                                                    std::less<KvResourceKey>,
                                                    std::vector<KvResourcePair>>;

   struct TransactionContextImpl;

   struct TransactionContext
   {
      BlockContext&                               blockContext;
      Database::Session                           session;
      const SignedTransaction&                    signedTransaction;
      TransactionTrace&                           transactionTrace;
      KvResourceMap                               kvResourceDeltas;
      int                                         callDepth = 0;
      const std::chrono::steady_clock::time_point startTime;

      TransactionContext(BlockContext&            blockContext,
                         const SignedTransaction& signedTransaction,
                         TransactionTrace&        transactionTrace,
                         bool                     enableUndo);
      ~TransactionContext();

      void execTransaction();
      void execCalledAction(uint64_t callerFlags, const Action& act, ActionTrace& atrace);
      void execServe(const Action& act, ActionTrace& atrace);

      ExecutionContext& getExecutionContext(AccountNumber contract);

      std::chrono::steady_clock::duration getContractLoadTime();

      // Set watchdog timer; it will expire at startTime + contractLoadTime + watchdogLimit.
      // It automatically expands when contractLoadTime expands.
      void setWatchdog(std::chrono::steady_clock::duration watchdogLimit);

      // Cancel execution of all executionContexts because of timeout; may be called from another thread
      void asyncTimeout();

     private:
      std::unique_ptr<TransactionContextImpl> impl;
   };  // TransactionContext

}  // namespace psibase
