#pragma once

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
      psibase::system_context& system_context;
      Database                 db;
      Database::Session        session;
      Block                    current;
      DatabaseStatusRow        databaseStatus;
      size_t                   nextSubjectiveRead = 0;
      bool                     isProducing        = false;
      bool                     isReadOnly         = false;
      bool                     isGenesisBlock     = false;
      bool                     needGenesisAction  = false;
      bool                     started            = false;
      bool                     active             = false;

      BlockContext(psibase::system_context& system_context, bool isProducing, bool enableUndo);
      BlockContext(psibase::system_context& system_context, ReadOnly);

      void checkActive() { check(active, "block is not active"); }

      void start(std::optional<TimePointSec> time = {});
      void start(Block&& src);
      void commit();

      void pushTransaction(const SignedTransaction& trx,
                           TransactionTrace&        trace,
                           bool                     enableUndo = true,
                           bool                     commit     = true);

      TransactionTrace pushTransaction(const SignedTransaction& trx)
      {
         TransactionTrace trace;
         pushTransaction(trx, trace);
         return trace;
      }

      void execAllInBlock();

      void exec(const SignedTransaction& trx,
                TransactionTrace&        trace,
                bool                     enableUndo,
                bool                     commit);
   };  // BlockContext
}  // namespace psibase
