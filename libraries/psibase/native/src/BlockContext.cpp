#include <psibase/TransactionContext.hpp>

namespace psibase
{
   BlockContext::BlockContext(psibase::SystemContext& systemContext,
                              bool                    isProducing,
                              bool                    enableUndo)
       : systemContext{systemContext},
         db{systemContext.sharedDatabase},
         session{db.startWrite()},
         isProducing{isProducing}
   {
      check(enableUndo, "TODO: revisit enableUndo option");
   }

   BlockContext::BlockContext(psibase::SystemContext& systemContext, ReadOnly)
       : systemContext{systemContext},
         db{systemContext.sharedDatabase},
         session{db.startRead()},
         isProducing{true},  // a read_only block is never replayed
         isReadOnly{true}
   {
   }

   // TODO: (or elsewhere) graceful shutdown when db size hits threshold
   void BlockContext::start(std::optional<TimePointSec> time)
   {
      check(!started, "block has already been started");
      auto status = db.kvGet<status_row>(status_row::kv_map, status_key());
      if (!status)
      {
         status.emplace();
         if (!isReadOnly)
            db.kvPut(status_row::kv_map, status->key(), *status);
      }
      auto dbStatus = db.kvGet<DatabaseStatusRow>(DatabaseStatusRow::kv_map, databaseStatusKey());
      if (!dbStatus)
      {
         dbStatus.emplace();
         if (!isReadOnly)
            db.kvPut(DatabaseStatusRow::kv_map, dbStatus->key(), *dbStatus);
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
         isGenesisBlock          = true;
         needGenesisAction       = true;
         current.header.blockNum = 2;
         if (time)
            current.header.time = *time;
      }
      started = true;
      active  = true;
   }

   // TODO: (or elsewhere) check block signature
   void BlockContext::start(Block&& src)
   {
      start(src.header.time);
      active = false;
      check(src.header.previous == current.header.previous,
            "block previous does not match expected");
      check(src.header.blockNum == current.header.blockNum, "block num does not match expected");
      current = std::move(src);
      active  = true;
   }

   void BlockContext::commit()
   {
      checkActive();
      check(!needGenesisAction, "missing genesis action in block");
      active = false;

      auto status = db.kvGet<status_row>(status_row::kv_map, status_key());
      check(status.has_value(), "missing status record");
      status->head = current;
      if (isGenesisBlock)
         status->chain_id = status->head->blockId;
      db.kvPut(status_row::kv_map, status->key(), *status);

      // TODO: store block IDs somewhere?
      // TODO: store block proofs somewhere
      // TODO: avoid repacking
      db.kvPut(kv_map::block_log, current.header.blockNum, current);

      session.commit();
   }

   void BlockContext::pushTransaction(const SignedTransaction& trx,
                                      TransactionTrace&        trace,
                                      bool                     enableUndo,
                                      bool                     commit)
   {
      auto subjectiveSize = current.subjectiveData.size();
      try
      {
         exec(trx, trace, enableUndo, commit);
         current.transactions.push_back(std::move(trx));
      }
      catch (...)
      {
         current.subjectiveData.resize(subjectiveSize);
         throw;
      }
   }

   void BlockContext::execAllInBlock()
   {
      for (auto& trx : current.transactions)
      {
         TransactionTrace trace;
         exec(trx, trace, false, true);
      }
      check(nextSubjectiveRead == current.subjectiveData.size(),
            "block has unread subjective data");
   }

   // TODO: limit charged CPU & NET which can go into a block
   // TODO: duplicate detection
   void BlockContext::exec(const SignedTransaction& trx,
                           TransactionTrace&        trace,
                           bool                     enableUndo,
                           bool                     commit)
   {
      try
      {
         checkActive();
         check(enableUndo || commit, "neither enableUndo or commit is set");

         // if !enableUndo then BlockContext becomes unusable if transaction
         // fails. This will cascade to a busy lock (database corruption) if
         // BlockContext::enableUndo is also false.
         active = enableUndo;

         TransactionContext t{*this, trx, trace, enableUndo};
         t.execTransaction();

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
