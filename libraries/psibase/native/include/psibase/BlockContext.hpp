#pragma once

#include <chrono>
#include <psibase/SystemContext.hpp>
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
      size_t            nextSubjectiveRead = 0;
      bool              isProducing        = false;
      bool              isReadOnly         = false;
      bool              isGenesisBlock     = false;
      bool              needGenesisAction  = false;
      bool              started            = false;
      bool              active             = false;

      BlockContext(SystemContext&                  systemContext,
                   std::shared_ptr<const Revision> revision,
                   WriterPtr                       writer,
                   bool                            isProducing);

      BlockContext(SystemContext&                  systemContext,
                   std::shared_ptr<const Revision> revision);  // Read-only mode

      void checkActive() { check(active, "block is not active"); }

      StatusRow                                start(std::optional<TimePointSec> time = {});
      void                                     start(Block&& src);
      void                                     callStartBlock();
      std::pair<ConstRevisionPtr, Checksum256> writeRevision();

      void verifyProof(const SignedTransaction&                 trx,
                       TransactionTrace&                        trace,
                       size_t                                   i,
                       std::optional<std::chrono::microseconds> watchdogLimit);

      void pushTransaction(const SignedTransaction&                 trx,
                           TransactionTrace&                        trace,
                           std::optional<std::chrono::microseconds> initialWatchdogLimit,
                           bool                                     enableUndo = true,
                           bool                                     commit     = true);

      void execAllInBlock();

      void exec(const SignedTransaction&                 trx,
                TransactionTrace&                        trace,
                std::optional<std::chrono::microseconds> initialWatchdogLimit,
                bool                                     enableUndo,
                bool                                     commit);

      psibase::TimePointSec getHeadBlockTime();
   };  // BlockContext
}  // namespace psibase
