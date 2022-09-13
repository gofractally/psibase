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

   // TODO: handle unpacking within TransactionContext?
   //       * Verify unpack of signed, no extra fields
   //       * Allow inner Transaction to have extra fields; transaction_sys should verify instead
   //       Might be redundant elsewhere?
   struct TransactionContext
   {
      BlockContext&                               blockContext;
      const SignedTransaction&                    signedTransaction;
      TransactionTrace&                           transactionTrace;
      ConfigRow                                   config;
      KvResourceMap                               kvResourceDeltas;
      int                                         callDepth = 0;
      const std::chrono::steady_clock::time_point startTime;
      std::chrono::steady_clock::duration         databaseTime;
      bool                                        allowDbRead;
      bool                                        allowDbWrite;
      bool                                        allowDbReadSubjective;

      TransactionContext(BlockContext&            blockContext,
                         const SignedTransaction& signedTransaction,
                         TransactionTrace&        transactionTrace,
                         bool                     allowDbRead,
                         bool                     allowDbWrite,
                         bool                     allowDbReadSubjective);
      ~TransactionContext();

      // Caution: each call to exec*(), except execCalledAction(),
      //          must be in a fresh TransactionContext instance.
      void execVerifyProof(size_t i);

      void execVerifyProof(const Checksum256& id, Claim claim, std::vector<char> proof);
      void checkFirstAuth();
      void execTransaction();

      void execNonTrxAction(uint64_t callerFlags, const Action& act, ActionTrace& atrace);
      void execCalledAction(uint64_t callerFlags, const Action& act, ActionTrace& atrace);
      void execServe(const Action& act, ActionTrace& atrace);

      ExecutionContext& getExecutionContext(AccountNumber service);

      std::chrono::nanoseconds getBillableTime();

      // Set watchdog timer; it will expire at startTime + serviceLoadTime + watchdogLimit.
      // This may be called multiple times with different limits; the most-recent limit applies.
      void setWatchdog(std::chrono::steady_clock::duration watchdogLimit);

     private:
      std::unique_ptr<TransactionContextImpl> impl;
   };  // TransactionContext

}  // namespace psibase
