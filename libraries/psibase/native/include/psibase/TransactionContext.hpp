#pragma once

#include <boost/container/flat_map.hpp>
#include <psibase/BlockContext.hpp>
#include <psibase/BucketSet.hpp>
#include <psibase/Socket.hpp>
#include <psibase/Watchdog.hpp>

namespace psizam::detail
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

      std::vector<Bucket> importedHandles;
      std::vector<Bucket> exportedHandles;

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

      // Stops the transaction's CPU budget while a service is compiled or its
      // compiled code is loaded: a node that already has the code must not
      // behave differently from one that does not. The budget runs again when
      // the returned object is destroyed.
      struct BillingPause
      {
         explicit BillingPause(TransactionContext& context);
         ~BillingPause();
         BillingPause(const BillingPause&) = delete;
         TransactionContext& context;
      };

      // Service code is about to be stored (a CodeByHashRow with vmType 0).
      // Runs the chain's admission rule (admitNativeWasm) under this
      // context's VM limits and throws its error if the code is not
      // admissible, which aborts the transaction. That part is billed: every
      // node does it at every such write, with or without a compiled module.
      // Then hands the code to the engine to compile ahead, with billing
      // paused: a node that already holds the module and one that compiles
      // it here bill the same and reach the same limit decision.
      void admitCode(const Checksum256& hash, std::span<const char> code, std::uint8_t vmVersion);

      // Set watchdog timer; it will expire at startTime + serviceLoadTime + watchdogLimit.
      // This may be called multiple times with different limits; the most-recent limit applies.
      /// The VM limits this context executes services under.
      const VMOptions& vmOptions() const;
      void setWatchdog(RunClock::duration watchdogLimit);

      const WasmConfigRow& getWasmConfig() const;

      // Returns the alt stack for wasm execution.
      psizam::detail::stack_manager& getAltStack();

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
