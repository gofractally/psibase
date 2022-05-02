#include <psibase/transaction_context.hpp>

namespace psibase
{
   block_context::block_context(psibase::system_context& system_context,
                                bool                     is_producing,
                                bool                     enable_undo)
       : system_context{system_context},
         db{system_context.shared_db},
         session{db.start_write()},
         is_producing{is_producing}
   {
      check(enable_undo, "TODO: revisit enable_undo option");
   }

   block_context::block_context(psibase::system_context& system_context, read_only)
       : system_context{system_context},
         db{system_context.shared_db},
         session{db.start_read()},
         is_producing{true},  // a read_only block is never replayed
         is_read_only{true}
   {
   }

   // TODO: (or elsewhere) graceful shutdown when db size hits threshold
   void block_context::start(std::optional<TimePointSec> time)
   {
      check(!started, "block has already been started");
      auto status = db.kv_get<status_row>(status_row::kv_map, status_key());
      if (!status)
      {
         status.emplace();
         if (!is_read_only)
            db.kv_put(status_row::kv_map, status->key(), *status);
      }
      auto dbStatus = db.kv_get<DatabaseStatusRow>(DatabaseStatusRow::kv_map, databaseStatusKey());
      if (!dbStatus)
      {
         dbStatus.emplace();
         if (!is_read_only)
            db.kv_put(DatabaseStatusRow::kv_map, dbStatus->key(), *dbStatus);
      }
      databaseStatus = *dbStatus;

      if (status->head)
      {
         current.header.previous = status->head->blockId;
         current.header.blockNum = status->head->header.blockNum + 1;
         if (time)
         {
            check(time->seconds > status->head->header.time.seconds, "block is in the past");
            current.header.time = *time;
         }
         else
         {
            current.header.time.seconds = status->head->header.time.seconds + 1;
         }
      }
      else
      {
         is_genesis_block        = true;
         need_genesis_action     = true;
         current.header.blockNum = 2;
         if (time)
            current.header.time = *time;
      }
      started = true;
      active  = true;
   }

   // TODO: (or elsewhere) check block signature
   void block_context::start(Block&& src)
   {
      start(src.header.time);
      active = false;
      check(src.header.previous == current.header.previous,
            "block previous does not match expected");
      check(src.header.blockNum == current.header.blockNum, "block num does not match expected");
      current = std::move(src);
      active  = true;
   }

   void block_context::commit()
   {
      check_active();
      check(!need_genesis_action, "missing genesis action in block");
      active = false;

      auto status = db.kv_get<status_row>(status_row::kv_map, status_key());
      check(status.has_value(), "missing status record");
      status->head = current;
      if (is_genesis_block)
         status->chain_id = status->head->blockId;
      db.kv_put(status_row::kv_map, status->key(), *status);

      // TODO: store block IDs somewhere?
      // TODO: store block proofs somewhere
      // TODO: avoid repacking
      db.kv_put(kv_map::block_log, current.header.blockNum, current);

      session.commit();
   }

   void block_context::push_transaction(const SignedTransaction& trx,
                                        transaction_trace&       trace,
                                        bool                     enable_undo,
                                        bool                     commit)
   {
      exec(trx, trace, enable_undo, commit);
      current.transactions.push_back(std::move(trx));
   }

   void block_context::exec_all_in_block()
   {
      for (auto& trx : current.transactions)
      {
         transaction_trace trace;
         exec(trx, trace, false, true);
      }
   }

   // TODO: limit charged CPU & NET which can go into a block
   // TODO: duplicate detection
   void block_context::exec(const SignedTransaction& trx,
                            transaction_trace&       trace,
                            bool                     enable_undo,
                            bool                     commit)
   {
      try
      {
         check_active();
         check(enable_undo || commit, "neither enable_undo or commit is set");

         // if !enable_undo then block_context becomes unusable if transaction
         // fails. This will cascade to a busy lock (database corruption) if
         // block_context::enable_undo is also false.
         active = enable_undo;

         trace.trx = trx;
         transaction_context t{*this, trx, trace, enable_undo};
         t.exec_transaction();

         if (commit)
         {
            // TODO: limit billed time in block
            check(!(trx.transaction.tapos.flags & Tapos::do_not_broadcast),
                  "cannot commit a do_not_broadcast transaction");
            t.session.commit();
            active = true;
         }
      }
      catch (const std::exception& e)
      {
         trace.error = e.what();
         throw;
      }
   }

}  // namespace psibase
