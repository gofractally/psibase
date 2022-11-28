#include <psibase/TransactionContext.hpp>
#include <psibase/serviceEntry.hpp>

namespace psibase
{
   BlockContext::BlockContext(psibase::SystemContext&         systemContext,
                              std::shared_ptr<const Revision> revision,
                              WriterPtr                       writer,
                              bool                            isProducing)
       : systemContext{systemContext},
         db{systemContext.sharedDatabase, std::move(revision)},
         writer{std::move(writer)},
         session{db.startWrite(this->writer)},
         isProducing{isProducing}
   {
   }

   BlockContext::BlockContext(psibase::SystemContext&         systemContext,
                              std::shared_ptr<const Revision> revision)
       : systemContext{systemContext},
         db{systemContext.sharedDatabase, std::move(revision)},
         session{db.startRead()},
         isProducing{true},  // a read_only block is never replayed
         isReadOnly{true}
   {
   }

   // TODO: (or elsewhere) graceful shutdown when db size hits threshold
   StatusRow BlockContext::start(std::optional<TimePointSec> time,
                                 AccountNumber               producer,
                                 TermNum                     term,
                                 BlockNum                    irreversible)
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

      current.header.producer  = producer;
      current.header.term      = term;
      current.header.commitNum = irreversible;
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
      if (status->nextConsensus &&
          std::get<1>(*status->nextConsensus) <= status->head->header.commitNum)
      {
         status->consensus = std::move(std::get<0>(*status->nextConsensus));
         status->nextConsensus.reset();
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
      // TODO: zero out header fields that are filled at the end of the block
      db.kvPut(StatusRow::db, status.key(), status);
      active = true;
   }

   void BlockContext::callStartBlock()
   {
      if (current.header.blockNum == 2)
         return;

      checkActive();
      active = false;

      Action action{
          .sender  = {},
          .service = transactionServiceNum,
          .method  = MethodNumber("startBlock"),
          .rawData = {},
      };
      SignedTransaction  trx;
      TransactionTrace   trace;
      TransactionContext tc{*this, trx, trace, true, true, false};
      auto&              atrace = trace.actionTraces.emplace_back();

      // Failure here aborts the block since transaction-sys relies on startBlock
      // functioning correctly. Fixing this type of failure requires forking
      // the chain, just like fixing bugs which block transactions within
      // transaction-sys's processTransaction may require forking the chain.
      //
      // TODO: log failure
      tc.execNonTrxAction(0, action, atrace);
      // printf("%s\n", prettyTrace(atrace).c_str());

      active = true;
   }

   std::pair<ConstRevisionPtr, Checksum256> BlockContext::writeRevision(const Prover& prover,
                                                                        const Claim&  claim)
   {
      checkActive();
      check(!needGenesisAction, "missing genesis action in block");
      active = false;

      auto status = db.kvGet<StatusRow>(StatusRow::db, statusKey());
      check(status.has_value(), "missing status record");

      if (status->nextConsensus && std::get<1>(*status->nextConsensus) == status->current.blockNum)
      {
         auto& nextConsensus = std::get<0>(*status->nextConsensus);
         auto& prods         = std::visit(
                     [](auto& c) -> auto& { return c.producers; }, nextConsensus);
         // Special case: If no producers are specified, use the producers of the current block
         if (prods.empty())
         {
            prods.emplace_back(current.header.producer, Claim{});
         }

         status->current.newConsensus = current.header.newConsensus = nextConsensus;
      }

      status->head = current;  // Also calculates blockId
      if (isGenesisBlock)
         status->chainId = status->head->blockId;

      // These values will be replaced at the start of the next block.
      // Changing the these here gives services running in RPC mode
      // the illusion that they're running during the production of a new
      // block. This helps to give them a consistent view between production
      // and RPC modes.
      status->current.previous     = status->head->blockId;
      status->current.blockNum     = status->head->header.blockNum + 1;
      status->current.time.seconds = status->head->header.time.seconds + 1;

      db.kvPut(StatusRow::db, status->key(), *status);

      // TODO: store block proofs somewhere
      // TODO: avoid repacking
      db.kvPut(DbId::blockLog, current.header.blockNum, current);
      db.kvPut(DbId::blockProof, current.header.blockNum,
               prover.prove(BlockSignatureInfo(*status->head), claim));

      return {session.writeRevision(status->head->blockId), status->head->blockId};
   }

   void BlockContext::verifyProof(const SignedTransaction&                 trx,
                                  TransactionTrace&                        trace,
                                  size_t                                   i,
                                  std::optional<std::chrono::microseconds> watchdogLimit)
   {
      try
      {
         checkActive();
         TransactionContext t{*this, trx, trace, false, false, false};
         if (watchdogLimit)
            t.setWatchdog(*watchdogLimit);
         t.execVerifyProof(i);
         if (!current.subjectiveData.empty())
            throw std::runtime_error("proof called a subjective service");
      }
      catch (const std::exception& e)
      {
         current.subjectiveData.clear();
         trace.error = e.what();
         throw;
      }
      catch (...)
      {
         current.subjectiveData.clear();
         throw;
      }
   }

   void BlockContext::checkFirstAuth(const SignedTransaction&                 trx,
                                     TransactionTrace&                        trace,
                                     std::optional<std::chrono::microseconds> watchdogLimit)
   {
      try
      {
         checkActive();
         TransactionContext t{*this, trx, trace, true, false, false};
         if (watchdogLimit)
            t.setWatchdog(*watchdogLimit);
         t.checkFirstAuth();
         current.subjectiveData.clear();
      }
      catch (const std::exception& e)
      {
         current.subjectiveData.clear();
         trace.error = e.what();
         throw;
      }
      catch (...)
      {
         current.subjectiveData.clear();
         throw;
      }
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

   // TODO: call callStartBlock() here? caller's responsibility?
   // TODO: caller needs to verify proofs
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

         // TODO: fracpack verify, allow new fields. Might be redundant elsewhere?
         check(!commit || !(trx.transaction->tapos()->flags().get() & Tapos::do_not_broadcast_flag),
               "cannot commit a do_not_broadcast transaction");

         // if !enableUndo then BlockContext becomes unusable if transaction fails.
         active = enableUndo;

         Database::Session session;
         if (enableUndo)
            session = db.startWrite(writer);

         TransactionContext t{*this, trx, trace, true, !isReadOnly, false};
         if (initialWatchdogLimit)
            t.setWatchdog(*initialWatchdogLimit);
         t.execTransaction();

         if (commit)
         {
            session.commit();
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
