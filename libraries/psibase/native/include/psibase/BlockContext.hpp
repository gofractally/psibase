#pragma once

#include <psibase/SystemContext.hpp>
#include <psibase/trace.hpp>

namespace psibase
{
   struct read_only
   {
   };

   // Note: forking must occur before a block_context is created
   struct block_context
   {
      psibase::system_context& system_context;
      database                 db;
      database::session        session;
      Block                    current;
      DatabaseStatusRow        databaseStatus;
      size_t                   nextSubjectiveRead  = 0;
      bool                     is_producing        = false;
      bool                     is_read_only        = false;
      bool                     is_genesis_block    = false;
      bool                     need_genesis_action = false;
      bool                     started             = false;
      bool                     active              = false;

      block_context(psibase::system_context& system_context, bool is_producing, bool enable_undo);
      block_context(psibase::system_context& system_context, read_only);

      void check_active() { check(active, "block is not active"); }

      void start(std::optional<TimePointSec> time = {});
      void start(Block&& src);
      void commit();

      void push_transaction(const SignedTransaction& trx,
                            TransactionTrace&        trace,
                            bool                     enable_undo = true,
                            bool                     commit      = true);

      TransactionTrace push_transaction(const SignedTransaction& trx)
      {
         TransactionTrace trace;
         push_transaction(trx, trace);
         return trace;
      }

      void exec_all_in_block();

      void exec(const SignedTransaction& trx,
                TransactionTrace&        trace,
                bool                     enable_undo,
                bool                     commit);
   };  // block_context

}  // namespace psibase
