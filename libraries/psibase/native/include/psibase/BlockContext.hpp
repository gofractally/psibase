#pragma once

#include <chrono>
#include <functional>
#include <optional>
#include <stdexcept>
#include <string>
#include <psibase/Prover.hpp>
#include <psibase/SystemContext.hpp>
#include <psibase/log.hpp>
#include <psibase/trace.hpp>

namespace psibase
{
   struct UsageRecord;
   // A block producer is not ready to apply a transaction from its queue in
   // the block it has open: the transaction needs service code this node has
   // not compiled (WasmCache::mustDefer). Nothing about the transaction: it
   // has no trace and no result, nobody is told it failed, and it is offered
   // again in a later block.
   struct TransactionDeferred : std::runtime_error
   {
      using std::runtime_error::runtime_error;
   };

   struct BlockContext
   {
      SystemContext&    systemContext;
      Database          db;
      WriterPtr         writer;
      Database::Session session;
      // Usage metering (gofractally/psibase#2270): the record that the work
      // done in this context is charged to, and that is remembered as the
      // origin of every run posted from it. Set by whoever creates the
      // context for a request, a socket message or a posted run. Always
      // null in a context that produces or applies a block: nothing on the
      // consensus path reads or writes it.
      std::shared_ptr<UsageRecord> usage;
      Block             current           = {};
      bool              isProducing       = false;
      bool              isReadOnly        = false;
      bool              isGenesisBlock    = false;
      bool              needGenesisAction = false;
      bool              started           = false;
      bool              active            = false;
      // The chain's limit on the transaction bytes in one block (ConfigRow),
      // as of the start of this block, and how many this block holds so far.
      std::uint32_t maxBlockSize     = 0;
      std::uint64_t transactionBytes = 0;

      // What a transaction counts for against maxBlockSize: its packed size
      // plus its proofs. Subjective data is left out; the producer adds it
      // while executing, after it has decided the transaction fits.
      static std::uint64_t blockBytes(const SignedTransaction& trx);
      // Whether the block being produced may take this transaction too. The
      // first transaction always fits.
      bool fits(const SignedTransaction& trx) const;
      // The rule a received block must satisfy: its transactions total at
      // most maxBlockSize, unless it holds a single transaction or is the
      // genesis block. Throws otherwise.
      void checkBlockSize() const;
      // Both of these are supersets of the actual values,
      // as they are not reverted when a transaction fails.
      std::set<AccountNumber>     modifiedAuthAccounts;
      std::set<CodeByHashKeyType> removedCode;

      // Initialized on first use
      std::optional<Checksum256> verifyContextId;

      // Set by a block producer around a transaction it took from its queue
      // (ForkDb::pushTransaction): the transaction is not to compile service
      // code or wait for a compile, at the write of a code row or at the
      // first execution of a service. If it would, exec throws
      // TransactionDeferred: at once where the code has to be executed, at
      // the end of the transaction where it was only stored (so that one
      // deferral starts the compile of everything the transaction stores).
      // Not set for boot blocks or by the tester, which
      // have no later block to defer to and no speculative run to have
      // compiled anything: they compile where they need the module.
      bool deferUncompiledCode = false;
      // Why the transaction being executed was deferred, set where that is
      // decided: exec tells a deferral from a failure by this and not by
      // the exception, which has passed through the engine by then.
      std::optional<std::string> deferral;

      loggers::common_logger trxLogger;

      BlockContext(SystemContext&                  systemContext,
                   std::shared_ptr<const Revision> revision,
                   WriterPtr                       writer,
                   bool                            isProducing);

      BlockContext(SystemContext&                  systemContext,
                   std::shared_ptr<const Revision> revision);  // Read-only mode

      void checkActive() { check(active, "block is not active"); }

      StatusRow start(std::optional<BlockTime> time     = {},
                      AccountNumber            producer = {},
                      TermNum                  term     = {},
                      BlockNum                 irr      = {});
      void      start(Block&& src);
      void      callStartBlock();
      void      callOnBlock();
      void      callOnTransaction(const Checksum256& id, const TransactionTrace& trace);
      std::optional<SignedTransaction> callNextTransaction();
      // \post The size of the result is the number of proofs in the
      // transaction. Entries that cannot be filled (including due to
      // errors) will be set to zero.
      std::vector<Checksum256>                 callPreverify(const SignedTransaction& trx);
      void callRun(psio::pssz_view<RunRow> row,
                   std::optional<std::chrono::microseconds> proofTimeout = std::nullopt);
      void reportSpeculativeCompile(std::uint64_t run, std::chrono::nanoseconds time);
      // Tests only: what reportSpeculativeCompile reported.
      std::function<void(std::uint64_t, std::chrono::nanoseconds)> speculativeCompileHook;
      void                                     callTimer(psio::pssz_view<TimerRow> row);
      Checksum256                              makeEventMerkleRoot();
      Checksum256                              makeTransactionMerkle();
      std::pair<ConstRevisionPtr, Checksum256> writeRevision(
          const Prover&,
          const Claim&,
          const ConstRevisionPtr& prevAuthServices = nullptr);

      void verifyProof(const SignedTransaction&                 trx,
                       TransactionTrace&                        trace,
                       size_t                                   i,
                       std::optional<std::chrono::microseconds> watchdogLimit,
                       BlockContext*                            errorContext,
                       const Checksum256&                       token = {});

      void pushTransaction(SignedTransaction&&                      trx,
                           TransactionTrace&                        trace,
                           std::optional<std::chrono::microseconds> initialWatchdogLimit,
                           bool                                     enableUndo = true,
                           bool                                     commit     = true);
      void replayTransaction(SignedTransaction&& trx, TransactionTrace& trace);

      // The action has the same database access rules as queries
      void execAsyncAction(Action&& action);
      auto execAsyncExport(std::string_view fn, Action&& action, TransactionTrace& trace)
          -> ActionTrace&;

      void execAllInBlock();

      std::vector<std::vector<char>> exec(
          const SignedTransaction&                 trx,
          TransactionTrace&                        trace,
          std::optional<std::chrono::microseconds> initialWatchdogLimit,
          bool                                     enableUndo,
          bool                                     commit);

      Checksum256 getVerifyContextId();

      psibase::BlockTime getHeadBlockTime();
   };  // BlockContext
}  // namespace psibase
