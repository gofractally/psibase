#include <psibase/TransactionContext.hpp>
#include <psibase/saturating.hpp>
#include <psibase/serviceEntry.hpp>
#include <psio/finally.hpp>

namespace psibase
{
   BlockContext::BlockContext(psibase::SystemContext& systemContext,
                              ConstRevisionPtr        revision,
                              WriterPtr               writer,
                              bool                    isProducing)
       : systemContext{systemContext},
         writer{std::move(writer)},
         isProducing{isProducing}
   {
      kv.setBaseRevision(revision);
      kv._writer    = this->writer.get();
      kv._shared_db = &systemContext.sharedDatabase;
      // Create a transaction from the specific revision root, not from root 0's
      // published state.  This is critical for fork handling: different BlockContexts
      // may start from different revisions (e.g. fork A vs fork B), but root 0 only
      // reflects the most recently published head.
      auto* ws = this->writer.get();
      consensus_tx.emplace(
          this->writer->allocator_session(),
          std::move(revision),
          [ws](sal::smart_ptr<sal::alloc_header> new_root)
          { ws->set_root(0, std::move(new_root), ws->get_sync()); },
          []() {},
          psitri::tx_mode::batch);
      kv.consensus_tx = &*consensus_tx;
      trxLogger.add_attribute("Channel",
                              boost::log::attributes::constant(std::string("transaction")));
   }

   BlockContext::BlockContext(psibase::SystemContext& systemContext,
                              ConstRevisionPtr        revision)
       : systemContext{systemContext},
         isProducing{true},  // a read_only block is never replayed
         isReadOnly{true}
   {
      kv.setBaseRevision(revision);
      // Read-only: use cursor directly, no transaction needed
      if (revision)
         kv.consensus_cursor.emplace(std::move(revision));
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
   StatusRow BlockContext::start(std::optional<BlockTime> time,
                                 AccountNumber            producer,
                                 TermNum                  term,
                                 BlockNum                 irreversible)
   {
      check(!started, "block has already been started");
      auto status = kv.kvGet<StatusRow>(StatusRow::db, statusKey());
      if (!status)
         status.emplace();

      auto dbStatus = kv.kvGet<DatabaseStatusRow>(DatabaseStatusRow::db, databaseStatusKey());
      if (!dbStatus)
      {
         dbStatus.emplace();
         if (!isReadOnly)
            kv.kvPut(DatabaseStatusRow::db, dbStatus->key(), *dbStatus);
      }

      current.header.producer = producer;
      current.header.term     = term;
      if (status->head)
      {
         current.header.previous = status->head->blockId;
         current.header.blockNum = status->head->header.blockNum + 1;
         if (time)
         {
            check(time > status->head->header.time, "block is in the past");
            current.header.time = *time;
         }
         else
         {
            current.header.time = status->head->header.time + Seconds(1);
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
            kv.setPrevAuthServices({});
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
         kv.kvPut(StatusRow::db, status->key(), *status);
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
      kv.kvPut(StatusRow::db, status.key(), status);
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
      TransactionContext tc{*this, trx, trace, DbMode::transaction()};
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
          kv.kvGetRaw(NotifyRow::db, psio::convert_to_key(notifyKey(NotifyType::acceptBlock)));
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
         TransactionContext tc{*this, trx, trace, DbMode::callback()};
         auto&              atrace = trace.actionTraces.emplace_back();

         try
         {
            auto frame = consensus_tx->sub_transaction();
            tc.execNonTrxAction(0, action, atrace);
            frame.commit();
            BOOST_LOG_SCOPED_LOGGER_TAG(trxLogger, "Trace", trace);
            PSIBASE_LOG(trxLogger, debug) << "onBlock succeeded";
         }
         catch (std::exception& e)
         {
            trace.error = e.what();
            BOOST_LOG_SCOPED_LOGGER_TAG(trxLogger, "Trace", trace);
            PSIBASE_LOG(trxLogger, warning) << "onBlock failed: " << e.what();
         }
      }
   }

   void BlockContext::callOnTransaction(const Checksum256& id, const TransactionTrace& trace)
   {
      auto notifyType = trace.error ? NotifyType::rejectTransaction : NotifyType::acceptTransaction;
      auto notifyData = kv.kvGetRaw(NotifyRow::db, psio::convert_to_key(notifyKey(notifyType)));
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
         TransactionContext tc{*this, trx, trace, DbMode::callback()};
         auto&              atrace = trace.actionTraces.emplace_back();

         try
         {
            auto frame = consensus_tx->sub_transaction();
            tc.execNonTrxAction(0, action, atrace);
            frame.commit();
            BOOST_LOG_SCOPED_LOGGER_TAG(trxLogger, "Trace", trace);
            PSIBASE_LOG(trxLogger, debug) << "onTransaction succeeded";
         }
         catch (std::exception& e)
         {
            trace.error = e.what();
            BOOST_LOG_SCOPED_LOGGER_TAG(trxLogger, "Trace", trace);
            PSIBASE_LOG(trxLogger, warning) << "onTransaction failed: " << e.what();
         }
      }
   }

   namespace
   {
      struct VerifyTokenData
      {
         bool        success;
         RunMode     mode;
         Action      action;
         Checksum256 context;
         PSIO_REFLECT(VerifyTokenData, success, mode, action, context)
      };
   }  // namespace
   Checksum256 BlockContext::getVerifyContextId()
   {
      check(current.transactions.empty(),
            "Internal error: a block context used to verify signatures should not have any "
            "transactions applied.");
      if (verifyContextId)
         return *verifyContextId;
      Checksum256 result{};
      auto        status = kv.kvGet<StatusRow>(StatusRow::db, statusKey());
      if (status && status->head)
      {
         auto& services = status->consensus.next ? status->consensus.next->consensus.services
                                                 : status->consensus.current.services;
         result         = sha256(services);
      }
      verifyContextId = result;
      return result;
   }

   std::optional<SignedTransaction> BlockContext::callNextTransaction()
   {
      auto notifyType = NotifyType::nextTransaction;
      auto notifyData = systemContext.sharedDatabase.kvGetSubjective(
          *writer, DbId::nativeSubjective, psio::convert_to_key(notifyKey(notifyType)));
      if (!notifyData)
      {
         PSIBASE_LOG(trxLogger, debug) << "nextTransaction not set";
         return {};
      }
      if (!psio::fracpack_validate<NotifyRow>(*notifyData))
      {
         PSIBASE_LOG(trxLogger, warning) << "invalid nextTransaction row";
         return {};
      }

      auto actions = psio::view<const NotifyRow>(psio::prevalidated{*notifyData}).actions();

      auto oldIsProducing = isProducing;
      auto restore        = psio::finally{[&] { isProducing = oldIsProducing; }};
      isProducing         = true;

      Action action{.sender = AccountNumber{}, .rawData = psio::to_frac(std::tuple())};

      for (auto a : actions)
      {
         if (a.sender() != AccountNumber{})
         {
            PSIBASE_LOG(trxLogger, warning) << "Invalid nextTransaction callback" << std::endl;
            continue;
         }
         if (!a.rawData().empty())
         {
            PSIBASE_LOG(trxLogger, warning) << "Invalid nextTransaction callback" << std::endl;
            continue;
         }
         action.service = a.service();
         action.method  = a.method();
         SignedTransaction  trx;
         TransactionTrace   trace;
         TransactionContext tc{*this, trx, trace, DbMode::callback()};
         auto&              atrace = trace.actionTraces.emplace_back();

         try
         {
            auto frame = consensus_tx->sub_transaction();
            tc.execNonTrxAction(0, action, atrace);
            frame.commit();

            std::optional<SignedTransaction> result;
            if (!psio::from_frac(result, atrace.rawRetval))
            {
               BOOST_LOG_SCOPED_LOGGER_TAG(trxLogger, "Trace", std::move(trace));
               PSIBASE_LOG(trxLogger, warning)
                   << "failed to deserialize result of " << action.service.str()
                   << "::" << action.method.str();
            }
            else
            {
               BOOST_LOG_SCOPED_LOGGER_TAG(trxLogger, "Trace", std::move(trace));
               PSIBASE_LOG(trxLogger, debug) << "nextTransaction succeeded";
               if (result)
                  return result;
            }
         }
         catch (std::exception& e)
         {
            trace.error = e.what();
            BOOST_LOG_SCOPED_LOGGER_TAG(trxLogger, "Trace", trace);
            PSIBASE_LOG(trxLogger, warning) << "nextTransaction failed: " << e.what();
         }
      }
      return {};
   }

   std::vector<Checksum256> BlockContext::callPreverify(const SignedTransaction& trx)
   {
      std::vector<Checksum256> tokens(trx.proofs.size());
      auto                     notifyType = NotifyType::preverifyTransaction;
      auto                     notifyData = systemContext.sharedDatabase.kvGetSubjective(
          *writer, DbId::nativeSubjective, psio::convert_to_key(notifyKey(notifyType)));
      if (!notifyData)
         return tokens;
      if (!psio::fracpack_validate<NotifyRow>(*notifyData))
         return tokens;

      auto actions = psio::view<const NotifyRow>(psio::prevalidated{*notifyData}).actions();

      auto oldIsProducing = isProducing;
      auto restore        = psio::finally{[&] { isProducing = oldIsProducing; }};
      isProducing         = true;

      Action action{.sender = AccountNumber{}, .rawData = psio::to_frac(std::tie(trx))};

      for (auto a : actions)
      {
         if (a.sender() != AccountNumber{})
         {
            PSIBASE_LOG(trxLogger, warning) << "Invalid preverifyTransaction callback" << std::endl;
            continue;
         }
         if (!a.rawData().empty())
         {
            PSIBASE_LOG(trxLogger, warning) << "Invalid preverifyTransaction callback" << std::endl;
            continue;
         }
         action.service = a.service();
         action.method  = a.method();
         SignedTransaction  trx;
         TransactionTrace   trace;
         TransactionContext tc{*this, trx, trace, DbMode::callback()};
         auto&              atrace = trace.actionTraces.emplace_back();

         try
         {
            auto frame = consensus_tx->sub_transaction();
            tc.execNonTrxAction(0, action, atrace);
            frame.commit();

            std::optional<std::vector<std::optional<RunToken>>> result;
            if (!psio::from_frac(result, atrace.rawRetval))
            {
               BOOST_LOG_SCOPED_LOGGER_TAG(trxLogger, "Trace", std::move(trace));
               PSIBASE_LOG(trxLogger, warning)
                   << "failed to deserialize result of " << action.service.str()
                   << "::" << action.method.str();
            }
            else
            {
               BOOST_LOG_SCOPED_LOGGER_TAG(trxLogger, "Trace", std::move(trace));
               PSIBASE_LOG(trxLogger, debug) << "preverifyTransaction succeeded";
               if (result)
               {
                  std::ranges::transform(std::views::take(*result, tokens.size()), tokens.begin(),
                                         [](const auto& token)
                                         {
                                            Checksum256 value = {};
                                            if (token && token->size() == value.size())
                                            {
                                               std::ranges::copy(*token, value.begin());
                                            }
                                            return value;
                                         });
                  break;
               }
            }
         }
         catch (std::exception& e)
         {
            trace.error = e.what();
            BOOST_LOG_SCOPED_LOGGER_TAG(trxLogger, "Trace", trace);
            PSIBASE_LOG(trxLogger, warning) << "preverifyTransaction failed: " << e.what();
         }
      }

      return tokens;
   }

   void BlockContext::callRun(psio::view<const RunRow> row)
   {
      auto action = row.action().unpack();

      DbMode mode = DbMode::rpc();
      switch (row.mode().unpack())
      {
         case RunMode::verify:
            mode = DbMode::verify();
            break;
         case RunMode::speculative:
            mode = DbMode::transaction();
            break;
         case RunMode::rpc:
            mode = DbMode::rpc();
            break;
         default:
            PSIBASE_LOG(trxLogger, warning) << "Wrong run mode should be caught earlier";
            break;
      }
      SignedTransaction  trx;
      TransactionTrace   trace;
      TransactionContext tc{*this, trx, trace, mode};
      auto&              atrace = trace.actionTraces.emplace_back();

      try
      {
         auto frame = consensus_tx->sub_transaction();
         auto maxTime = saturatingCast<CpuClock::duration>(row.maxTime().unpack());
         tc.setWatchdog(std::max(maxTime, CpuClock::duration::zero()));
         if (row.mode() == RunMode::speculative)
         {
            kv.checkoutEmptySubjective(*writer);
            auto _ = psio::finally{[&] { kv.abortSubjective(); }};
            tc.execNonTrxAction(0, action, atrace);
         }
         else
         {
            tc.execNonTrxAction(0, action, atrace);
         }
         PSIBASE_LOG(trxLogger, debug)
             << "async " << action.service.str() << "::" << action.method.str() << " succeeded";
      }
      catch (std::exception& e)
      {
         trace.error = e.what();
         BOOST_LOG_SCOPED_LOGGER_TAG(trxLogger, "Trace", trace);
         PSIBASE_LOG(trxLogger, debug) << "async " << action.service.str()
                                       << "::" << action.method.str() << " failed: " << e.what();
      }

      try
      {
         auto frame = consensus_tx->sub_transaction();
         auto token   = sha256(
             VerifyTokenData{!trace.error, row.mode(), action,
                             row.mode() == RunMode::verify ? getVerifyContextId() : Checksum256{}});
         // Run the continuation
         Action action{
             .sender  = {},
             .service = row.continuation().service(),
             .method  = row.continuation().method(),
             .rawData = psio::to_frac(std::tuple(
                 row.id().unpack(), trace, std::optional{std::span(token.data(), token.size())}))};
         TransactionTrace   trace;
         TransactionContext tc{*this, trx, trace, DbMode::rpc()};
         auto&              atrace = trace.actionTraces.emplace_back();
         tc.execNonTrxAction(0, action, atrace);
         BOOST_LOG_SCOPED_LOGGER_TAG(trxLogger, "Trace", trace);
         PSIBASE_LOG(trxLogger, debug) << "async continuation " << action.service.str()
                                       << "::" << action.method.str() << " succeeded";
      }
      catch (std::exception& e)
      {
         trace.error = e.what();
         BOOST_LOG_SCOPED_LOGGER_TAG(trxLogger, "Trace", trace);
         PSIBASE_LOG(trxLogger, warning)
             << "async continuation " << row.continuation().service().unpack().str()
             << "::" << row.continuation().method().unpack().str() << " failed: " << e.what();
      }
   }

   void BlockContext::callTimer(psio::view<const TimerRow> row)
   {
      SignedTransaction trx;
      TransactionTrace  trace;
      try
      {
         auto               frame = consensus_tx->sub_transaction();
         psibase::Action    action{.service = row.service(),
                                   .method  = row.method(),
                                   .rawData = psio::to_frac(std::tuple())};
         TransactionContext tc{*this, trx, trace, DbMode::rpc()};
         auto&              atrace = trace.actionTraces.emplace_back();
         tc.execNonTrxAction(0, action, atrace);
         BOOST_LOG_SCOPED_LOGGER_TAG(trxLogger, "Trace", trace);
         PSIBASE_LOG(trxLogger, debug) << "timer callback " << action.service.str()
                                       << "::" << action.method.str() << " succeeded";
      }
      catch (std::exception& e)
      {
         trace.error = e.what();
         BOOST_LOG_SCOPED_LOGGER_TAG(trxLogger, "Trace", trace);
         PSIBASE_LOG(trxLogger, warning)
             << "timer callback " << row.service().unpack().str()
             << "::" << row.method().unpack().str() << " failed: " << e.what();
      }
   }

   Checksum256 BlockContext::makeEventMerkleRoot()
   {
      auto dbStatus = kv.kvGet<DatabaseStatusRow>(DatabaseStatusRow::db, databaseStatusKey());
      check(!!dbStatus, "databaseStatus not set");

      Merkle m;
      for (std::uint64_t i   = dbStatus->blockMerkleEventNumber,
                         end = dbStatus->nextMerkleEventNumber;
           i != end; ++i)
      {
         auto data = kv.kvGetRaw(DbId::merkleEvent, psio::convert_to_key(i));
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
   void updateAuthServices(KVStore&    db,
                           StatusRow&  status,
                           Block&      current,
                           const auto& modifiedAuthAccounts,
                           const auto& removedCode)
   {
      auto& currentAuthServices = status.consensus.next ? status.consensus.next->consensus.services
                                                        : status.consensus.current.services;

      std::vector<BlockHeaderAuthAccount> modifiedAuthServices;
      std::vector<BlockHeaderCode>        authCode;
      // Used for set-union of modified and current accounts
      auto currentIter = currentAuthServices.begin();
      auto currentEnd  = currentAuthServices.end();
      // Tracking of CodeByHashRows
      auto origCodeKeys    = getCodeKeys(currentAuthServices);
      auto visitedCodeKeys = std::map<CodeByHashKeyType, bool>{};
      auto hasCode         = [&](const BlockHeaderAuthAccount& account, bool existing = true)
      {
         auto key             = codeByHashKey(account.codeHash, account.vmType, account.vmVersion);
         auto [pos, inserted] = visitedCodeKeys.insert({key, false});
         if (inserted)
         {
            existing = existing || std::ranges::binary_search(origCodeKeys, key);
            if (existing && removedCode.find(key) == removedCode.end())
            {
               pos->second = true;
            }
            if (!pos->second)
            {
               if (auto code = db.kvGet<CodeByHashRow>(CodeByHashRow::db, key))
               {
                  if (!existing)
                  {
                     authCode.push_back({.vmType    = code->vmType,
                                         .vmVersion = code->vmVersion,
                                         .code      = std::move(code->code)});
                  }
                  pos->second = true;
               }
            }
         }
         return pos->second;
      };
      for (const auto& account : modifiedAuthAccounts)
      {
         // Copy elements of currentAuthServices that were not touched
         const BlockHeaderAuthAccount* existing = nullptr;
         while (currentIter != currentEnd)
         {
            if (currentIter->codeNum < account)
            {
               if (hasCode(*currentIter))
                  modifiedAuthServices.push_back(*currentIter);
               ++currentIter;
            }
            else
            {
               if (currentIter->codeNum == account)
               {
                  existing = &*currentIter;
                  ++currentIter;
               }
               break;
            }
         }
         // look up the account
         if (auto row = db.kvGet<CodeRow>(CodeRow::db, codeKey(account)))
         {
            if (row->flags & CodeRow::isVerify)
            {
               BlockHeaderAuthAccount item{.codeNum   = row->codeNum,
                                           .codeHash  = row->codeHash,
                                           .vmType    = row->vmType,
                                           .vmVersion = row->vmVersion};
               if (hasCode(item, existing && *existing == item))
                  modifiedAuthServices.push_back(item);
            }
         }
      }
      // Copy any trailing elements
      std::copy_if(currentIter, currentEnd, std::back_inserter(modifiedAuthServices), hasCode);

      auto& oldWasmConfig =
          (status.consensus.next ? status.consensus.next->consensus : status.consensus.current)
              .wasmConfig;
      auto proofWasmConfig =
          db.kvGet<WasmConfigRow>(WasmConfigRow::db, WasmConfigRow::key(proofWasmConfigTable))
              .value_or(WasmConfigRow{});
      auto newWasmConfig =
          BlockHeaderWasmConfig{.numExecutionMemories = proofWasmConfig.numExecutionMemories,
                                .vmOptions            = proofWasmConfig.vmOptions};

      // Check for changes and update the consensus field
      if (modifiedAuthServices != currentAuthServices || oldWasmConfig != newWasmConfig)
      {
         current.header.authCode = std::move(authCode);
         if (!status.consensus.next)
            status.consensus.next =
                PendingConsensus{{status.consensus.current.data, std::move(modifiedAuthServices),
                                  std::move(newWasmConfig)},
                                 status.current.blockNum};
         else
         {
            status.consensus.next->consensus.services   = std::move(modifiedAuthServices);
            status.consensus.next->consensus.wasmConfig = newWasmConfig;
            status.consensus.next->blockNum             = status.current.blockNum;
         }
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

      auto status = kv.kvGet<StatusRow>(StatusRow::db, statusKey());
      check(status.has_value(), "missing status record");

      updateAuthServices(kv, *status, current, modifiedAuthAccounts, removedCode);

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

      // Defer subjective writes until after the consensus transaction commits.
      // Subjective kvPut calls set_root which triggers sync(), advancing
      // _first_write_pos on the shared allocator session and making consensus
      // nodes allocated during this transaction read-only prematurely.
      std::optional<ConsensusChangeRow> deferredChangeRow;
      if (status->consensus.next && status->consensus.next->blockNum <= current.header.commitNum)
      {
         deferredChangeRow.emplace(ConsensusChangeRow{status->consensus.next->blockNum,
                                                      current.header.commitNum,
                                                      current.header.blockNum});
      }

      if (status->consensus.next)
      {
         if (prevAuthServices)
         {
            kv.setPrevAuthServices(prevAuthServices);
         }
         else if (!status->consensus.current.services.empty() && !kv.getPrevAuthServices())
         {
            assert(status->consensus.next->blockNum == current.header.blockNum);
            kv.setPrevAuthServices(kv.getBaseRevision());
         }
      }
      else
      {
         check(!kv.getPrevAuthServices(),
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

      auto dbStatus = kv.kvGet<DatabaseStatusRow>(DatabaseStatusRow::db, databaseStatusKey());
      check(!!dbStatus, "databaseStatus not set");
      dbStatus->blockMerkleEventNumber = dbStatus->nextMerkleEventNumber;
      kv.kvPut(DatabaseStatusRow::db, dbStatus->key(), *dbStatus);

      // These values will be replaced at the start of the next block.
      // Changing the these here gives services running in RPC mode
      // the illusion that they're running during the production of a new
      // block. This helps to give them a consistent view between production
      // and RPC modes.
      status->current.previous = status->head->blockId;
      status->current.blockNum = status->head->header.blockNum + 1;
      status->current.time     = status->head->header.time + Seconds(1);

      kv.kvPut(StatusRow::db, status->key(), *status);

      // TODO: store block proofs somewhere
      // TODO: avoid repacking
      kv.kvPut(DbId::blockLog, current.header.blockNum, current);
      kv.kvPut(DbId::blockProof, current.header.blockNum,
               prover.prove(BlockSignatureInfo(*status->head), claim));

      callOnBlock();

      // Capture the current tree root as the revision snapshot, then commit.
      auto root = consensus_tx->read_cursor().get_root();
      consensus_tx->commit();

      // Store revision by blockId and update head
      systemContext.sharedDatabase.writeRevision(*writer, status->head->blockId, root);
      systemContext.sharedDatabase.setHead(*writer, root);

      // Now safe to do subjective writes — consensus transaction is committed
      if (deferredChangeRow)
      {
         systemContext.sharedDatabase.kvPutSubjective(
             *writer, ConsensusChangeRow::db,
             psio::convert_to_key(deferredChangeRow->key()),
             psio::to_frac(*deferredChangeRow));
      }

      return {root, status->head->blockId};
   }

   void BlockContext::verifyProof(const SignedTransaction&                 trx,
                                  TransactionTrace&                        trace,
                                  size_t                                   i,
                                  std::optional<std::chrono::microseconds> watchdogLimit,
                                  BlockContext*                            errorContext,
                                  const Checksum256&                       token)
   {
      auto id = sha256(trx.transaction.data(), trx.transaction.size());
      BOOST_LOG_SCOPED_THREAD_TAG("TransactionId", id);
      try
      {
         checkActive();
         auto act = makeVerify(trx, id, i);
         if (token != Checksum256{})
         {
            auto expectedToken =
                sha256(VerifyTokenData{true, RunMode::verify, act, getVerifyContextId()});
            if (expectedToken == token)
            {
               PSIBASE_LOG(trxLogger, debug) << "Skipped signature verification " << i
                                             << " because a matching token was provided";
               return;
            }
            PSIBASE_LOG(trxLogger, warning)
                << "Signature verification token " << i << "is out-dated or invalid";
         }
         TransactionContext t{*this, trx, trace, DbMode::verify()};
         if (watchdogLimit)
            t.setWatchdog(*watchdogLimit);
         auto& atrace = trace.actionTraces.emplace_back();
         t.execNonTrxAction(0, act, atrace);
         if (!t.subjectiveData.empty())
            throw std::runtime_error("proof called a subjective service");
      }
      catch (const std::exception& e)
      {
         trace.error = e.what();
         BOOST_LOG_SCOPED_LOGGER_TAG(trxLogger, "Trace", trace);
         PSIBASE_LOG(trxLogger, info) << "Transaction signature verification failed";
         if (errorContext)
            errorContext->callOnTransaction(id, trace);
         throw;
      }
      catch (...)
      {
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

   void BlockContext::replayTransaction(SignedTransaction&& trx, TransactionTrace& trace)
   {
      assert(!isProducing);
      check(!!trx.subjectiveData, "Missing subjective data");
      exec(trx, trace, std::nullopt, false, true);
      current.transactions.push_back(std::move(trx));
   }

   void BlockContext::execAsyncAction(Action&& action)
   {
      SignedTransaction  trx;
      TransactionTrace   trace;
      auto&              atrace = trace.actionTraces.emplace_back();
      TransactionContext tc{*this, trx, trace, DbMode::rpc()};

      tc.execNonTrxAction(0, action, atrace);
   }

   auto BlockContext::execAsyncExport(std::string_view fn, Action&& action, TransactionTrace& trace)
       -> ActionTrace&
   {
      SignedTransaction  trx;
      auto&              atrace = trace.actionTraces.emplace_back();
      TransactionContext tc{*this, trx, trace, DbMode::rpc()};

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

         std::optional<psitri::transaction_frame_ref> frame;
         if (enableUndo)
            frame.emplace(consensus_tx->sub_transaction());

         std::vector<std::vector<char>> result;
         {
            TransactionContext t{*this, trx, trace, DbMode::transaction()};
            if (initialWatchdogLimit)
               t.setWatchdog(*initialWatchdogLimit);
            t.execTransaction();

            if (!isProducing)
            {
               check(t.nextSubjectiveRead == trx.subjectiveData->size(),
                     "transaction has unread subjective data");
            }
            result = std::move(t.subjectiveData);
         }

         if (commit)
         {
            if (frame)
               frame->commit();
            callOnTransaction(id, trace);
            active = true;
         }
         BOOST_LOG_SCOPED_LOGGER_TAG(trxLogger, "Trace", trace);
         PSIBASE_LOG(trxLogger, info) << "Transaction succeeded";
         return result;
      }
      catch (const std::exception& e)
      {
         trace.error = e.what();
         BOOST_LOG_SCOPED_LOGGER_TAG(trxLogger, "Trace", trace);
         PSIBASE_LOG(trxLogger, info) << "Transaction failed";
         callOnTransaction(id, trace);
         throw;
      }
   }

   psibase::BlockTime BlockContext::getHeadBlockTime()
   {
      auto status = kv.kvGet<StatusRow>(StatusRow::db, statusKey());
      if (!status || !(status->head))
      {
         return psibase::TimePointSec{};
      }
      else
      {
         return status->head->header.time;
      }
   }

}  // namespace psibase
