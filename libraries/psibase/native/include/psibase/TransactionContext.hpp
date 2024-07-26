#pragma once

#include <boost/container/flat_map.hpp>
#include <psibase/BlockContext.hpp>
#include <psibase/Socket.hpp>

namespace eosio::vm
{
   struct stack_manager;
}

namespace psibase
{
   using KvResourceMap = boost::container::flat_map<KvResourceKey,
                                                    KvResourceDelta,
                                                    std::less<KvResourceKey>,
                                                    std::vector<KvResourcePair>>;

   struct TransactionContextImpl;

   // TODO: handle unpacking within TransactionContext?
   //       * Verify unpack of signed, no extra fields
   //       * Allow inner Transaction to have extra fields; transact should verify instead
   //       Might be redundant elsewhere?
   struct TransactionContext
   {
      BlockContext&                       blockContext;
      const SignedTransaction&            signedTransaction;
      TransactionTrace&                   transactionTrace;
      ConfigRow                           config;
      KvResourceMap                       kvResourceDeltas;
      std::uint32_t                       remainingStack = 0;
      std::chrono::steady_clock::duration databaseTime;
      bool                                allowDbRead;
      bool                                allowDbWrite;
      bool                                allowDbReadSubjective;
      bool                                allowDbWriteSubjective;
      std::vector<std::vector<char>>      subjectiveData;
      size_t                              nextSubjectiveRead = 0;

      // sockets that will be closed when the transaction context finishes
      SocketAutoCloseSet ownedSockets;

      TransactionContext(BlockContext&            blockContext,
                         const SignedTransaction& signedTransaction,
                         TransactionTrace&        transactionTrace,
                         bool                     allowDbRead,
                         bool                     allowDbWrite,
                         bool                     allowDbReadSubjective,
                         bool                     allowDbWriteSubjective = false);
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
      void execExport(std::string_view fn, const Action& action, ActionTrace& atrace);

      ExecutionContext& getExecutionContext(AccountNumber service);

      std::chrono::nanoseconds getBillableTime();

      // Set watchdog timer; it will expire at startTime + serviceLoadTime + watchdogLimit.
      // This may be called multiple times with different limits; the most-recent limit applies.
      void setWatchdog(std::chrono::steady_clock::duration watchdogLimit);

      // Returns the alt stack for wasm execution.
      eosio::vm::stack_manager& getAltStack();

      void incCodeRef(const Checksum256& codeHash,
                      std::uint8_t       vmType,
                      std::uint8_t       vmVersion,
                      std::int64_t       delta);
      void incCodeRef(const auto& code, std::int64_t delta)
      {
         incCodeRef(code.codeHash, code.vmType, code.vmVersion, delta);
      }

     private:
      std::unique_ptr<TransactionContextImpl> impl;
   };  // TransactionContext

}  // namespace psibase
