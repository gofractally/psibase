#pragma once

#include <boost/container/flat_map.hpp>
#include <psibase/BlockContext.hpp>
#include <psibase/Socket.hpp>
#include <psibase/Watchdog.hpp>

namespace eosio::vm
{
   struct stack_manager;
}

namespace psibase
{
   using KvResourceMap = std::vector<KvResourcePair>;

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
      DbMode                              dbMode;
      std::vector<std::vector<char>>      subjectiveData;
      size_t                              nextSubjectiveRead = 0;

      // sockets that will be closed when the transaction context finishes
      SocketAutoCloseSet ownedSockets;

      TransactionContext(BlockContext&            blockContext,
                         const SignedTransaction& signedTransaction,
                         TransactionTrace&        transactionTrace,
                         DbMode                   dbMode);
      ~TransactionContext();

      // Caution: each call to exec*(), except execCalledAction(),
      //          must be in a fresh TransactionContext instance.
      void execVerifyProof(size_t i);

      void execVerifyProof(const Checksum256& id, Claim claim, std::vector<char> proof);
      void execTransaction();

      void execNonTrxAction(uint64_t callerFlags, const Action& act, ActionTrace& atrace);
      void execCalledAction(uint64_t callerFlags, const Action& act, ActionTrace& atrace);
      void execCalledAction(uint64_t      callerFlags,
                            const Action& act,
                            ActionTrace&  atrace,
                            CallFlags     flags);
      void execServe(const Action& act, ActionTrace& atrace);
      void execExport(std::string_view fn, const Action& action, ActionTrace& atrace);

      ExecutionContext& getExecutionContext(AccountNumber service);

      std::chrono::nanoseconds getBillableTime();

      // Set watchdog timer; it will expire at startTime + serviceLoadTime + watchdogLimit.
      // This may be called multiple times with different limits; the most-recent limit applies.
      void setWatchdog(CpuClock::duration watchdogLimit);

      const WasmConfigRow& getWasmConfig() const;

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
