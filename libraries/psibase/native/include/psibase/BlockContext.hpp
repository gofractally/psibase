#pragma once

#include <chrono>
#include <psibase/Prover.hpp>
#include <psibase/SystemContext.hpp>
#include <psibase/log.hpp>
#include <psibase/trace.hpp>

namespace psibase
{
   struct BlockContext
   {
      SystemContext&    systemContext;
      Database          db;
      WriterPtr         writer;
      Database::Session session;
      Block             current;
      DatabaseStatusRow databaseStatus;
      bool              isProducing       = false;
      bool              isReadOnly        = false;
      bool              isGenesisBlock    = false;
      bool              needGenesisAction = false;
      bool              started           = false;
      bool              active            = false;
      //
      std::map<AccountNumber, bool> modifiedAuthAccounts;

      loggers::common_logger trxLogger;

      BlockContext(SystemContext&                  systemContext,
                   std::shared_ptr<const Revision> revision,
                   WriterPtr                       writer,
                   bool                            isProducing);

      BlockContext(SystemContext&                  systemContext,
                   std::shared_ptr<const Revision> revision);  // Read-only mode

      void checkActive() { check(active, "block is not active"); }

      StatusRow start(std::optional<TimePointSec> time     = {},
                      AccountNumber               producer = {},
                      TermNum                     term     = {},
                      BlockNum                    irr      = {});
      void      start(Block&& src);
      void      callStartBlock();
      void      callOnBlock();
      void      callOnTransaction(const Checksum256& id, const TransactionTrace& trace);
      std::optional<SignedTransaction>         callNextTransaction();
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
                       BlockContext*                            errorContext);

      void checkFirstAuth(const SignedTransaction&                 trx,
                          TransactionTrace&                        trace,
                          std::optional<std::chrono::microseconds> watchdogLimit,
                          BlockContext*                            errorContext);

      void pushTransaction(SignedTransaction&&                      trx,
                           TransactionTrace&                        trace,
                           std::optional<std::chrono::microseconds> initialWatchdogLimit,
                           bool                                     enableUndo = true,
                           bool                                     commit     = true);

      // The action is not allowed to modify any consensus state.
      // It is allowed to read and write subjective tables.
      void execNonTrxAction(Action&& action, ActionTrace& trace);
      auto execExport(std::string_view  fn,
                      Action&&          action,
                      TransactionTrace& trace) -> ActionTrace&;
      // The action has the same database access rules as queries
      void execAsyncAction(Action&& action);
      auto execAsyncExport(std::string_view  fn,
                           Action&&          action,
                           TransactionTrace& trace) -> ActionTrace&;

      void execAllInBlock();

      std::vector<std::vector<char>> exec(
          const SignedTransaction&                 trx,
          TransactionTrace&                        trace,
          std::optional<std::chrono::microseconds> initialWatchdogLimit,
          bool                                     enableUndo,
          bool                                     commit);

      psibase::TimePointSec getHeadBlockTime();
   };  // BlockContext
}  // namespace psibase
