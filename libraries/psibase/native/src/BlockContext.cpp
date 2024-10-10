#include <psibase/TransactionContext.hpp>
#include <psibase/serviceEntry.hpp>
#include <psio/finally.hpp>

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
      trxLogger.add_attribute("Channel",
                              boost::log::attributes::constant(std::string("transaction")));
   }

   BlockContext::BlockContext(psibase::SystemContext&         systemContext,
                              std::shared_ptr<const Revision> revision)
       : systemContext{systemContext},
         db{systemContext.sharedDatabase, std::move(revision)},
         session{db.startRead()},
         isProducing{true},  // a read_only block is never replayed
         isReadOnly{true}
   {
      trxLogger.add_attribute("Channel",
                              boost::log::attributes::constant(std::string("transaction")));
   }

   static bool singleProducer(const StatusRow& status, AccountNumber producer)
   {
      auto getProducers = [](auto& consensus) -> auto&
      {
         return std::visit([](auto& c) -> auto& { return c.producers; }, consensus);
      };
      auto& prods = getProducers(status.consensus.current.data);
      if (prods.size() == 1)
      {
         return !status.consensus.next;
      }
      else if (prods.size() == 0)
      {
         return true;
      }
      return false;
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

      current.header.producer = producer;
      current.header.term     = term;
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
      if (status->consensus.next &&
          status->consensus.next->blockNum <= status->head->header.commitNum)
      {
         status->consensus.current = std::move(status->consensus.next->consensus);
         status->consensus.next.reset();
         if (!isReadOnly)
            db.setPrevAuthServices(nullptr);
      }
      if (singleProducer(*status, producer))
      {
         // This will be updated to the current block in writeRevision unless
         // the block sets new producers.
         current.header.commitNum = current.header.blockNum - 1;
      }
      else
      {
         current.header.commitNum = irreversible;
      }
      if (!status->head)
      {
         status->consensus.next.emplace(Consensus{}, current.header.blockNum);
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
      auto status =
          start(src.header.time, src.header.producer, src.header.term, src.header.commitNum);
      active = false;
      check(src.header.previous == current.header.previous,
            "block previous does not match expected");
      check(src.header.blockNum == current.header.blockNum, "block num does not match expected");
      current.transactions = std::move(src.transactions);
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
          .rawData = psio::to_frac(std::tuple()),
      };
      SignedTransaction  trx;
      TransactionTrace   trace;
      TransactionContext tc{*this, trx, trace, true, true, false};
      auto&              atrace = trace.actionTraces.emplace_back();

      // Failure here aborts the block since Transact relies on startBlock
      // functioning correctly. Fixing this type of failure requires forking
      // the chain, just like fixing bugs which block transactions within
      // Transact's processTransaction may require forking the chain.
      //
      // TODO: log failure
      tc.execNonTrxAction(0, action, atrace);
      BOOST_LOG_SCOPED_LOGGER_TAG(trxLogger, "Trace", trace);
      PSIBASE_LOG(trxLogger, debug) << "startBlock succeeded";
      // printf("%s\n", prettyTrace(atrace).c_str());

      active = true;
   }

   void BlockContext::callOnBlock()
   {
      auto notifyData =
          db.kvGetRaw(NotifyRow::db, psio::convert_to_key(notifyKey(NotifyType::acceptBlock)));
      if (!notifyData)
         return;
      auto notifySpan = std::span{notifyData->pos, notifyData->end};
      if (!psio::fracpack_validate<NotifyRow>(notifySpan))
         return;

      auto actions = psio::view<const NotifyRow>(psio::prevalidated{notifySpan}).actions().unpack();

      auto oldIsProducing = isProducing;
      auto restore        = psio::finally{[&] { isProducing = oldIsProducing; }};
      isProducing         = true;

      for (const Action& action : actions)
      {
         if (action.sender != AccountNumber{})
            continue;
         SignedTransaction  trx;
         TransactionTrace   trace;
         TransactionContext tc{*this, trx, trace, true, false, true, true};
         auto&              atrace = trace.actionTraces.emplace_back();

         try
         {
            tc.execNonTrxAction(0, action, atrace);
            BOOST_LOG_SCOPED_LOGGER_TAG(trxLogger, "Trace", trace);
            PSIBASE_LOG(trxLogger, debug) << "onBlock succeeded";
         }
         catch (std::exception& e)
         {
            PSIBASE_LOG(trxLogger, warning) << "onBlock failed: " << e.what();
         }
      }
   }

   void BlockContext::callOnTransaction(const Checksum256& id, const TransactionTrace& trace)
   {
      auto notifyType = trace.error ? NotifyType::rejectTransaction : NotifyType::acceptTransaction;
      auto notifyData = db.kvGetRaw(NotifyRow::db, psio::convert_to_key(notifyKey(notifyType)));
      if (!notifyData)
         return;
      auto notifySpan = std::span{notifyData->pos, notifyData->end};
      if (!psio::fracpack_validate<NotifyRow>(notifySpan))
         return;

      auto actions = psio::view<const NotifyRow>(psio::prevalidated{notifySpan}).actions().unpack();

      auto oldIsProducing = isProducing;
      auto restore        = psio::finally{[&] { isProducing = oldIsProducing; }};
      isProducing         = true;

      Action action{.sender = AccountNumber{}, .rawData = psio::to_frac(std::tuple(id, trace))};

      for (const auto& a : actions)
      {
         if (a.sender != AccountNumber{})
         {
            PSIBASE_LOG(trxLogger, warning) << "Invalid onTransaction callback" << std::endl;
            continue;
         }
         if (!a.rawData.empty())
         {
            PSIBASE_LOG(trxLogger, warning) << "Invalid onTransaction callback" << std::endl;
            continue;
         }
         action.service = a.service;
         action.method  = a.method;
         SignedTransaction  trx;
         TransactionTrace   trace;
         TransactionContext tc{*this, trx, trace, true, false, true, true};
         auto&              atrace = trace.actionTraces.emplace_back();

         try
         {
            tc.execNonTrxAction(0, action, atrace);
            BOOST_LOG_SCOPED_LOGGER_TAG(trxLogger, "Trace", trace);
            PSIBASE_LOG(trxLogger, debug) << "onTransaction succeeded";
         }
         catch (std::exception& e)
         {
            PSIBASE_LOG(trxLogger, warning) << "onTransaction failed: " << e.what();
         }
      }
   }

   Checksum256 BlockContext::makeEventMerkleRoot()
   {
      Merkle m;
      for (std::uint64_t i   = databaseStatus.blockMerkleEventNumber,
                         end = databaseStatus.nextMerkleEventNumber;
           i != end; ++i)
      {
         auto data = db.kvGetRaw(DbId::merkleEvent, psio::convert_to_key(i));
         m.push(EventInfo{i, std::span{data->pos, data->end}});
      }
      return m.root();
   }

   Checksum256 BlockContext::makeTransactionMerkle()
   {
      Merkle m;
      for (const SignedTransaction& trx : current.transactions)
      {
         m.push(TransactionInfo{trx});
      }
      return m.root();
   }

   // May start joint consensus if the set of services changed
   void updateAuthServices(Database&   db,
                           StatusRow&  status,
                           Block&      current,
                           const auto& modifiedAuthAccounts)
   {
      auto& currentAuthServices = status.consensus.next ? status.consensus.next->consensus.services
                                                        : status.consensus.current.services;

      std::vector<BlockHeaderAuthAccount> modifiedAuthServices;
      for (const auto& account : currentAuthServices)
      {
         if (modifiedAuthAccounts.find(account.codeNum) == modifiedAuthAccounts.end())
         {
            modifiedAuthServices.push_back(account);
         }
      }
      for (const auto& [name, exists] : modifiedAuthAccounts)
      {
         if (exists)
         {
            auto row = db.kvGet<CodeRow>(CodeRow::db, codeKey(name));
            assert(!!row);
            modifiedAuthServices.push_back({.codeNum   = row->codeNum,
                                            .codeHash  = row->codeHash,
                                            .vmType    = row->vmType,
                                            .vmVersion = row->vmVersion});
         }
      }
      std::ranges::sort(modifiedAuthServices,
                        [](const auto& lhs, const auto& rhs) { return lhs.codeNum < rhs.codeNum; });
      if (modifiedAuthServices != currentAuthServices)
      {
         current.header.authCode.emplace();
         auto               origKeys    = getCodeKeys(currentAuthServices);
         auto               currentKeys = getCodeKeys(modifiedAuthServices);
         decltype(origKeys) addedKeys;
         std::ranges::set_difference(currentKeys, origKeys, std::back_inserter(addedKeys));
         for (const auto& key : addedKeys)
         {
            auto code = db.kvGet<CodeByHashRow>(CodeByHashRow::db, key);
            check(!!code, "Missing code for auth service");
            current.header.authCode->push_back(
                {.vmType = code->vmType, .vmVersion = code->vmVersion, .code = code->code});
         }
         if (!status.consensus.next)
            status.consensus.next =
                PendingConsensus{{status.consensus.current.data, std::move(modifiedAuthServices)},
                                 status.current.blockNum};
         else
            status.consensus.next->consensus.services = std::move(modifiedAuthServices);
      }
   }

   std::pair<ConstRevisionPtr, Checksum256> BlockContext::writeRevision(
       const Prover&           prover,
       const Claim&            claim,
       const ConstRevisionPtr& prevAuthServices)
   {
      checkActive();
      check(!needGenesisAction, "missing genesis action in block");
      active = false;

      auto status = db.kvGet<StatusRow>(StatusRow::db, statusKey());
      check(status.has_value(), "missing status record");

      updateAuthServices(db, *status, current, modifiedAuthAccounts);

      if (status->consensus.next && status->consensus.next->blockNum == status->current.blockNum)
      {
         auto& nextConsensus = status->consensus.next->consensus;
         auto& prods = std::visit([](auto& c) -> auto& { return c.producers; }, nextConsensus.data);
         // Special case: If no producers are specified, use the producers of the current block
         if (prods.empty())
         {
            prods.push_back({current.header.producer, Claim{}});
         }

         status->current.newConsensus = current.header.newConsensus = nextConsensus;
      }

      if (singleProducer(*status, current.header.producer))
      {
         // If singleProducer is true here, then it must have been true at the start of
         // the block as well, unless an existing newConsensus was modified, which is
         // not permitted.
         check(current.header.commitNum == current.header.blockNum - 1,
               "Forbidden consensus update");
         status->current.commitNum = current.header.commitNum = current.header.blockNum;
      }

      if (status->consensus.next && status->consensus.next->blockNum <= current.header.commitNum)
      {
         ConsensusChangeRow changeRow{status->consensus.next->blockNum, current.header.commitNum,
                                      current.header.blockNum};
         systemContext.sharedDatabase.kvPutSubjective(
             *writer, psio::convert_to_key(changeRow.key()), psio::to_frac(changeRow));
      }

      if (status->consensus.next)
      {
         if (prevAuthServices)
         {
            db.setPrevAuthServices(prevAuthServices);
         }
         else if (!status->consensus.current.services.empty() && !db.getPrevAuthServices())
         {
            assert(status->consensus.next->blockNum == current.header.blockNum);
            db.setPrevAuthServices(db.getBaseRevision());
         }
      }
      else
      {
         check(!db.getPrevAuthServices(),
               "prevAuthServices should not be set outside joint consensus");
      }

      status->current.consensusState = current.header.consensusState = sha256(status->consensus);
      status->current.trxMerkleRoot = current.header.trxMerkleRoot = makeTransactionMerkle();
      status->current.eventMerkleRoot = current.header.eventMerkleRoot = makeEventMerkleRoot();

      status->head = current;  // Also calculates blockId
      // authCode can be loaded from the database. We don't need an
      // extra copy in the status table.
      status->head->header.authCode.reset();
      if (isGenesisBlock)
         status->chainId = status->head->blockId;

      databaseStatus.blockMerkleEventNumber = databaseStatus.nextMerkleEventNumber;
      db.kvPut(DatabaseStatusRow::db, databaseStatus.key(), databaseStatus);

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

      callOnBlock();

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
         if (!t.subjectiveData.empty())
            throw std::runtime_error("proof called a subjective service");
      }
      catch (const std::exception& e)
      {
         auto id = sha256(trx.transaction.data(), trx.transaction.size());
         BOOST_LOG_SCOPED_THREAD_TAG("TransactionId", id);
         PSIBASE_LOG(trxLogger, info) << "Transaction signature verification failed";
         trace.error = e.what();
         callOnTransaction(id, trace);
         throw;
      }
      catch (...)
      {
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
      }
      catch (const std::exception& e)
      {
         auto id = sha256(trx.transaction.data(), trx.transaction.size());
         BOOST_LOG_SCOPED_THREAD_TAG("TransactionId", id);
         PSIBASE_LOG(trxLogger, info) << "Transaction check first auth failed";
         trace.error = e.what();
         callOnTransaction(id, trace);
         throw;
      }
   }

   void BlockContext::pushTransaction(SignedTransaction&&                      trx,
                                      TransactionTrace&                        trace,
                                      std::optional<std::chrono::microseconds> initialWatchdogLimit,
                                      bool                                     enableUndo,
                                      bool                                     commit)
   {
      check(!trx.subjectiveData, "Subjective data should be set by the block producer");
      trx.subjectiveData = exec(trx, trace, initialWatchdogLimit, enableUndo, commit);
      current.transactions.push_back(std::move(trx));
   }

   void BlockContext::execNonTrxAction(Action&& action, ActionTrace& atrace)
   {
      SignedTransaction  trx;
      TransactionTrace   trace;
      TransactionContext tc{*this, trx, trace, true, false, true, true};

      auto session = db.startWrite(writer);
      tc.execNonTrxAction(0, action, atrace);
      session.commit();
   }

   auto BlockContext::execExport(std::string_view  fn,
                                 Action&&          action,
                                 TransactionTrace& trace) -> ActionTrace&
   {
      SignedTransaction  trx;
      auto&              atrace = trace.actionTraces.emplace_back();
      TransactionContext tc{*this, trx, trace, true, false, true, true};

      auto session = db.startWrite(writer);
      tc.execExport(fn, action, atrace);
      session.commit();
      return atrace;
   }

   void BlockContext::execAsyncAction(Action&& action)
   {
      SignedTransaction  trx;
      TransactionTrace   trace;
      auto&              atrace = trace.actionTraces.emplace_back();
      TransactionContext tc{*this, trx, trace, true, false, true};

      tc.execNonTrxAction(0, action, atrace);
   }

   auto BlockContext::execAsyncExport(std::string_view  fn,
                                      Action&&          action,
                                      TransactionTrace& trace) -> ActionTrace&
   {
      SignedTransaction  trx;
      auto&              atrace = trace.actionTraces.emplace_back();
      TransactionContext tc{*this, trx, trace, true, false, true};

      tc.execExport(fn, action, atrace);
      return atrace;
   }

   // TODO: call callStartBlock() here? caller's responsibility?
   // TODO: caller needs to verify proofs
   void BlockContext::execAllInBlock()
   {
      for (auto& trx : current.transactions)
      {
         check(!!trx.subjectiveData, "Missing subjective data");
         TransactionTrace trace;
         exec(trx, trace, std::nullopt, false, true);
      }
   }

   std::vector<std::vector<char>> BlockContext::exec(
       const SignedTransaction&                 trx,
       TransactionTrace&                        trace,
       std::optional<std::chrono::microseconds> initialWatchdogLimit,
       bool                                     enableUndo,
       bool                                     commit)
   {
      auto id = sha256(trx.transaction.data(), trx.transaction.size());
      BOOST_LOG_SCOPED_THREAD_TAG("TransactionId", id);
      try
      {
         checkActive();
         check(enableUndo || commit, "neither enableUndo or commit is set");

         // TODO: fracpack verify, allow new fields. Might be redundant elsewhere?
         check(!commit || !(trx.transaction->tapos().flags() & Tapos::do_not_broadcast_flag),
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

         if (!isProducing)
         {
            check(t.nextSubjectiveRead == trx.subjectiveData->size(),
                  "transaction has unread subjective data");
         }

         if (commit)
         {
            session.commit();
            callOnTransaction(id, trace);
            active = true;
         }
         BOOST_LOG_SCOPED_LOGGER_TAG(trxLogger, "Trace", trace);
         PSIBASE_LOG(trxLogger, info) << "Transaction succeeded";
         return std::move(t.subjectiveData);
      }
      catch (const std::exception& e)
      {
         PSIBASE_LOG(trxLogger, info) << "Transaction failed";
         trace.error = e.what();
         callOnTransaction(id, trace);
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
