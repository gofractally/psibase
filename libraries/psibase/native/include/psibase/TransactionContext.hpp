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

   struct TransactionContext
   {
      BlockContext&                         blockContext;
      Database::Session                     session;
      const SignedTransaction&              signedTransaction;
      TransactionTrace&                     transactionTrace;
      KvResourceMap                         kvResourceDeltas;
      int                                   callDepth = 0;
      std::chrono::steady_clock::time_point startTime;
      std::chrono::steady_clock::duration   contractLoadTime{0};

      TransactionContext(BlockContext&            blockContext,
                         const SignedTransaction& signedTransaction,
                         TransactionTrace&        transactionTrace,
                         bool                     enableUndo);

      void execTransaction();
      void execCalledAction(uint64_t callerFlags, const Action& act, ActionTrace& atrace);
      void execServe(const Action& act, ActionTrace& atrace);

      ExecutionContext& getExecutionContext(AccountNumber contract);

      // Cancel execution of all executionContexts because of timeout; may be called from another thread
      void asyncTimeout();

     private:
      std::mutex                                ecMutex;
      bool                                      ecCanceled = false;
      std::map<AccountNumber, ExecutionContext> executionContexts;
   };  // TransactionContext

}  // namespace psibase
