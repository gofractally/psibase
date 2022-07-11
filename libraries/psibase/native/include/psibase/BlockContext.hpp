#pragma once

#include <chrono>
#include <psibase/SystemContext.hpp>
#include <psibase/trace.hpp>

namespace psibase
{
   struct ReadOnly
   {
   };

   // Note: forking must occur before a BlockContext is created
   struct BlockContext
   {
      SystemContext&    systemContext;
      Database          db;
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

      BlockContext(SystemContext& systemContext, bool isProducing, bool enableUndo);
      BlockContext(SystemContext& systemContext, ReadOnly);

      void checkActive() { check(active, "block is not active"); }

      StatusRow start(std::optional<TimePointSec> time = {});
      void      start(Block&& src);
      void      commit();

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
