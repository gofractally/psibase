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
   StatusRow BlockContext::start(std::optional<TimePointSec> time)
   {
      check(!started, "block has already been started");
      auto status = db.kvGet<StatusRow>(StatusRow::db, statusKey());
      if (!status)
         status.emplace();

      auto dbStatus = db.kvGet<DatabaseStatusRow>(DatabaseStatusRow::db, databaseStatusKey());
      if (!dbStatus)
      {
         dbStatus.emplace();
         if (!isReadOnly)
            db.kvPut(DatabaseStatusRow::db, dbStatus->key(), *dbStatus);
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
      status->current = current.header;
      if (!isReadOnly)
         db.kvPut(StatusRow::db, status->key(), *status);
      started = true;
      active  = true;
      return *status;
   }

   // TODO: (or elsewhere) check block signature
   void BlockContext::start(Block&& src)
   {
      auto status = start(src.header.time);
      active      = false;
      check(src.header.previous == current.header.previous,
            "block previous does not match expected");
      check(src.header.blockNum == current.header.blockNum, "block num does not match expected");
      current        = std::move(src);
      status.current = current.header;
      db.kvPut(StatusRow::db, status.key(), status);
      active = true;
   }

   void BlockContext::commit()
   {
      checkActive();
      check(!needGenesisAction, "missing genesis action in block");
      active = false;

      auto status = db.kvGet<StatusRow>(StatusRow::db, statusKey());
      check(status.has_value(), "missing status record");
      status->head = current;
      if (isGenesisBlock)
         status->chainId = status->head->blockId;
      db.kvPut(StatusRow::db, status->key(), *status);

      // TODO: store block IDs somewhere?
      // TODO: store block proofs somewhere
      // TODO: avoid repacking
      db.kvPut(DbId::blockLog, current.header.blockNum, current);

      session.commit();
   }

   void BlockContext::pushTransaction(const SignedTransaction&                 trx,
                                      TransactionTrace&                        trace,
                                      std::optional<std::chrono::microseconds> initialWatchdogLimit,
                                      bool                                     enableUndo,
                                      bool                                     commit)
   {
      auto subjectiveSize = current.subjectiveData.size();
      try
      {
         exec(trx, trace, initialWatchdogLimit, enableUndo, commit);
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
         exec(trx, trace, std::nullopt, false, true);
      }
      check(nextSubjectiveRead == current.subjectiveData.size(),
            "block has unread subjective data");
   }

   // TODO: limit charged CPU & NET which can go into a block
   // TODO: duplicate detection
   void BlockContext::exec(const SignedTransaction&                 trx,
                           TransactionTrace&                        trace,
                           std::optional<std::chrono::microseconds> initialWatchdogLimit,
                           bool                                     enableUndo,
                           bool                                     commit)
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
         if (initialWatchdogLimit)
            t.setWatchdog(*initialWatchdogLimit);
         t.execTransaction();

         if (commit)
         {
            // TODO: limit billed time in block
            // TODO: fracpack verify, allow new fields. Might be redundant elsewhere?
            check(!(trx.transaction->tapos()->flags().get() & Tapos::do_not_broadcast),
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

   psibase::TimePointSec BlockContext::getHeadBlockTime()
   {
      auto status = db.kvGet<StatusRow>(StatusRow::db, statusKey());
      if (!status || !(status->head))
      {
         return psibase::TimePointSec{0};
      }
      else
      {
         return status->head->header.time;
      }
   }

}  // namespace psibase
