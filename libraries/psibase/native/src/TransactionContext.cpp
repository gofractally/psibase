#include <psibase/TransactionContext.hpp>

#include <condition_variable>
#include <mutex>
#include <optional>
#include <psibase/ActionContext.hpp>
#include <psibase/Watchdog.hpp>
#include <psibase/serviceEntry.hpp>
#include <psio/finally.hpp>
#include <psizam/detail/execution_context.hpp>
#include <thread>

namespace psibase
{
   template <typename T>
   struct ScopedAtomic
   {
      ScopedAtomic(std::atomic<T>& value) : location(value), saved(value.load()) {}
      ~ScopedAtomic() { location.store(saved); }
      std::atomic<T>& location;
      T               saved;
   };

   struct TransactionContextImpl
   {
      explicit TransactionContextImpl(SystemContext& context)
          : vmTimedOut(psizam::detail::timed_run_has_timed_out),
            vmTimedOutBefore(vmTimedOut.load()),
            watchdog(std::in_place, *context.watchdogManager, [this] { asyncTimeout(); })
      {
      }
      ~TransactionContextImpl() noexcept
      {
         // Removing the watchdog waits for an in-flight manager callback.
         // Do this before taking mutex: the callback takes manager -> Tx.
         watchdog.reset();
         std::lock_guard guard{mutex};
         altExecContexts.clear();
         executionContexts.clear();
         // The watchdog marks this thread's VM as timed out, and each entry point
         // restores the mark when it returns. But a timeout can be reported
         // synchronously (a storage call notices the spent budget) before the
         // watchdog thread fires: the entry point has then already returned, and
         // the late callback would leave the mark set for whatever runs next on
         // this thread. No callback can arrive after the reset above.
         if (timedOut)
            vmTimedOut.store(vmTimedOutBefore);
      }
      void clearAltExecutionContexts()
      {
         std::lock_guard guard{mutex};
         altExecContexts.clear();
         if (timedOut)
            throw TimeoutException{};
      }
      void asyncTimeout();

      WasmConfigRow wasmConfig;

      // mutex protects timedOut and lookup/insertion/clear in both context maps.
      std::mutex                                mutex    = {};
      bool                                      timedOut = false;
      std::atomic<bool>&                        vmTimedOut;
      const bool                                vmTimedOutBefore;
      psizam::detail::stack_manager             altStack;
      std::map<AccountNumber, ExecutionContext> executionContexts = {};
      // alt execution contexts are used when executing in a different
      // run mode. They are always run in a subjective mode, and
      // may be reset when not currently executing.
      bool                                      altMode         = false;
      std::map<AccountNumber, ExecutionContext> altExecContexts = {};
      std::optional<Watchdog>                   watchdog;
   };

   TransactionContext::TransactionContext(BlockContext&            blockContext,
                                          const SignedTransaction& signedTransaction,
                                          TransactionTrace&        transactionTrace,
                                          DbMode                   dbMode)
       : blockContext{blockContext},
         signedTransaction{signedTransaction},
         transactionTrace{transactionTrace},
         dbMode(dbMode),
         impl{std::make_unique<TransactionContextImpl>(blockContext.systemContext)}
   {
      assert(blockContext.writer || dbMode.isReadOnly());
   }

   TransactionContext::~TransactionContext()
   {
      if (blockContext.writer)
      {
         ownedSockets.close(*blockContext.writer, *blockContext.systemContext.sockets);
         blockContext.db.clearTemporary();
      }
   }

   static void execGenesisAction(TransactionContext& self, const Action& action);
   static void execProcessTransaction(TransactionContext& self);

   void TransactionContext::execTransaction()
   try
   {
      // Propagate this request's budget/cancellation into synchronous storage-owner jobs.
      auto         storageAccounting = impl->watchdog->accountingScope();
      ScopedAtomic saved{impl->vmTimedOut};
      // Prepare for execution
      auto& db         = blockContext.db;
      config           = db.kvGetOrDefault<ConfigRow>(ConfigRow::db, ConfigRow::key());
      impl->wasmConfig = db.kvGetOrDefault<WasmConfigRow>(
          WasmConfigRow::db, WasmConfigRow::key(transactionWasmConfigTable));
      blockContext.systemContext.setNumMemories(impl->wasmConfig.numExecutionMemories);
      remainingStack = impl->wasmConfig.vmOptions.max_stack_bytes;

      if (blockContext.needGenesisAction)
      {
         // TODO: full fracpack validate, no unknown, recursive
         //       might be redundant elsewhere?
         auto trxView     = *signedTransaction.transaction;
         auto actionsView = trxView.actions();
         check(actionsView.size() == 1, "genesis transaction must have exactly 1 action");
         execGenesisAction(*this, actionsView[0]);
         blockContext.needGenesisAction = false;
      }
      else
      {
         execProcessTransaction(*this);
      }

      // If the transaction adjusted numExecutionMemories too big for this node, then attempt
      // to reject the transaction. It is possible for the node to go down in flames instead.
      impl->wasmConfig = db.kvGetOrDefault<WasmConfigRow>(
          WasmConfigRow::db, WasmConfigRow::key(transactionWasmConfigTable));
      blockContext.systemContext.setNumMemories(impl->wasmConfig.numExecutionMemories);
   }
   catch (const accounting::Cancelled&)
   {
      throw TimeoutException{};
   }

   static void execGenesisAction(TransactionContext& self, const Action& action)
   {
      auto& atrace  = self.transactionTrace.actionTraces.emplace_back();
      atrace.action = action;
      try
      {
         auto& db   = self.blockContext.db;
         auto  data = psio::from_frac_strict<GenesisActionData>(action.rawData);
         for (auto& service : data.services)
         {
            check(service.service.value, "account 0 is reserved");
            check(!db.kvGet<CodeRow>(CodeRow::db, codeKey(service.service)),
                  "account already created");
            CodeRow account{
                .codeNum = service.service,
                .flags   = service.flags,
            };
            db.kvPut(CodeRow::db, account.key(), account);
            if (service.flags & CodeRow::isVerify)
            {
               self.blockContext.modifiedAuthAccounts.insert(service.service);
            }
            setCode(db, service.service, service.vmType, service.vmVersion,
                    {service.code.data(), service.code.size()});
         }
      }
      catch (const std::exception& e)
      {
         atrace.error = e.what();
         throw;
      }
   }

   static void reportError(TransactionContext& self, const ActionTrace& atrace)
   {
      if (self.blockContext.writer)
      {
         self.ownedSockets.close(*self.blockContext.writer,
                                 *self.blockContext.systemContext.sockets, atrace.error);
      }
   }

   // TODO: eliminate extra copies
   static void execProcessTransaction(TransactionContext& self)
   {
      ProcessTransactionArgs args{.transaction = self.signedTransaction.transaction};

      Action action{
          .sender  = AccountNumber(),
          .service = transactionServiceNum,
          .rawData = psio::convert_to_frac(args),
      };
      auto& atrace  = self.transactionTrace.actionTraces.emplace_back();
      atrace.action = action;  // TODO: avoid copy and redundancy between action and atrace.action
      ActionContext ac = {self, action, self.transactionTrace.actionTraces.back()};
      try
      {
         auto& ec = self.getExecutionContext(transactionServiceNum);
         ec.execProcessTransaction(ac);
      }
      catch (std::exception& e)
      {
         atrace.error = e.what();
         reportError(self, atrace);
         throw;
      }
   }

   void TransactionContext::execVerifyProof(size_t i)
   try
   {
      // Propagate this request's budget/cancellation into synchronous storage-owner jobs.
      auto storageAccounting = impl->watchdog->accountingScope();
      // TODO: fracpack validation, allowing new fields in inner transaction. Might be redundant elsewhere?
      auto trxView    = *signedTransaction.transaction;
      auto claimsView = trxView.claims();
      check(signedTransaction.proofs.size() == claimsView.size(),
            "proofs and claims must have same size");
      auto id = sha256(signedTransaction.transaction.data(), signedTransaction.transaction.size());
      execVerifyProof(id, claimsView[i], signedTransaction.proofs[i]);
   }
   catch (const accounting::Cancelled&)
   {
      throw TimeoutException{};
   }

   void TransactionContext::execVerifyProof(const Checksum256& id,
                                            Claim              claim,
                                            std::vector<char>  proof)
   try
   {
      // Propagate this request's budget/cancellation into synchronous storage-owner jobs.
      auto         storageAccounting = impl->watchdog->accountingScope();
      ScopedAtomic saved{impl->vmTimedOut};
      auto&        db  = blockContext.db;
      config           = db.kvGetOrDefault<ConfigRow>(ConfigRow::db, ConfigRow::key());
      impl->wasmConfig = db.kvGetOrDefault<WasmConfigRow>(WasmConfigRow::db,
                                                          WasmConfigRow::key(proofWasmConfigTable));
      blockContext.systemContext.setNumMemories(impl->wasmConfig.numExecutionMemories);
      remainingStack = impl->wasmConfig.vmOptions.max_stack_bytes;

      VerifyArgs data{
          .transactionHash = id,
          .claim           = std::move(claim),
          .proof           = std::move(proof),
      };
      Action action{
          .sender  = {},
          .service = data.claim.service,
          .method  = MethodNumber{"verifySys"},
          .rawData = psio::convert_to_frac(data),
      };
      auto& atrace     = transactionTrace.actionTraces.emplace_back();
      atrace.action    = action;
      ActionContext ac = {*this, action, atrace};
      try
      {
         auto& ec = getExecutionContext(action.service);
         ec.execCalled(0, ac);
      }
      catch (std::exception& e)
      {
         atrace.error = e.what();
         reportError(*this, atrace);
         throw;
      }
   }
   catch (const accounting::Cancelled&)
   {
      throw TimeoutException{};
   }

   void TransactionContext::execNonTrxAction(uint64_t      callerFlags,
                                             const Action& action,
                                             ActionTrace&  atrace)
   try
   {
      // Propagate this request's budget/cancellation into synchronous storage-owner jobs.
      auto         storageAccounting = impl->watchdog->accountingScope();
      ScopedAtomic saved{impl->vmTimedOut};
      auto&        db      = blockContext.db;
      config               = db.kvGetOrDefault<ConfigRow>(ConfigRow::db, ConfigRow::key());
      auto wasmConfigTable = dbMode.verifyOnly ? proofWasmConfigTable : transactionWasmConfigTable;
      impl->wasmConfig =
          db.kvGetOrDefault<WasmConfigRow>(WasmConfigRow::db, WasmConfigRow::key(wasmConfigTable));
      blockContext.systemContext.setNumMemories(impl->wasmConfig.numExecutionMemories);
      remainingStack = impl->wasmConfig.vmOptions.max_stack_bytes;

      atrace.action    = action;
      ActionContext ac = {*this, action, atrace};
      try
      {
         auto& ec = getExecutionContext(action.service);
         ec.execCalled(callerFlags, ac);
      }
      catch (std::exception& e)
      {
         atrace.error = e.what();
         reportError(*this, atrace);
         throw;
      }
   }
   catch (const accounting::Cancelled&)
   {
      throw TimeoutException{};
   }

   void TransactionContext::execCalledAction(uint64_t      callerFlags,
                                             const Action& action,
                                             ActionTrace&  atrace)
   try
   {
      // Propagate this request's budget/cancellation into synchronous storage-owner jobs.
      auto storageAccounting = impl->watchdog->accountingScope();
      atrace.action          = action;
      ActionContext ac       = {*this, action, atrace};
      try
      {
         auto& ec = getExecutionContext(action.service);
         ec.execCalled(callerFlags, ac);
      }
      catch (std::exception& e)
      {
         atrace.error = e.what();
         throw;
      }
   }
   catch (const accounting::Cancelled&)
   {
      throw TimeoutException{};
   }

   void TransactionContext::execCalledAction(uint64_t      callerFlags,
                                             const Action& action,
                                             ActionTrace&  atrace,
                                             CallFlags     flags)
   try
   {
      // Propagate this request's budget/cancellation into synchronous storage-owner jobs.
      auto storageAccounting = impl->watchdog->accountingScope();
      if (flags == CallFlags::none)
      {
         execCalledAction(callerFlags, action, atrace);
      }
      else
      {
         callerFlags |= ExecutionContext::callerSudo;
         auto scopedChangeMode = [&]()
         {
            assert(!impl->altMode);
            assert(dbMode.isSync);
            assert(!dbMode.isSubjective);
            impl->altMode       = true;
            dbMode.isSync       = flags == CallFlags::runModeCallback;
            dbMode.isSubjective = true;
            return psio::finally{[this]
                                 {
                                    impl->altMode       = false;
                                    dbMode.isSync       = true;
                                    dbMode.isSubjective = false;
                                 }};
         };

         exportedHandles.clear();
         if (blockContext.isProducing)
         {
            auto mode = scopedChangeMode();
            execCalledAction(callerFlags, action, atrace);
            subjectiveData.push_back(atrace.rawRetval);
         }
         else
         {
            if (flags == CallFlags::runModeCallback)
            {
               try
               {
                  auto mode = scopedChangeMode();
                  execCalledAction(callerFlags, action, atrace);
               }
               catch (...)
               {
                  // These can be cleared safely, because none of them
                  // are currently running.
                  impl->clearAltExecutionContexts();
               }
            }
            auto& subjective = signedTransaction.subjectiveData;
            check(subjective && nextSubjectiveRead < subjective->size(), "missing subjective data");
            atrace.rawRetval = (*subjective)[nextSubjectiveRead++];
         }
         importedHandles.clear();
      }
   }
   catch (const accounting::Cancelled&)
   {
      throw TimeoutException{};
   }

   // TODO: different wasmConfig, controlled by config file
   void TransactionContext::execServe(const Action& action, ActionTrace& atrace)
   try
   {
      // Propagate this request's budget/cancellation into synchronous storage-owner jobs.
      auto         storageAccounting = impl->watchdog->accountingScope();
      ScopedAtomic saved{impl->vmTimedOut};
      auto&        db  = blockContext.db;
      config           = db.kvGetOrDefault<ConfigRow>(ConfigRow::db, ConfigRow::key());
      impl->wasmConfig = db.kvGetOrDefault<WasmConfigRow>(
          WasmConfigRow::db, WasmConfigRow::key(transactionWasmConfigTable));
      blockContext.systemContext.setNumMemories(impl->wasmConfig.numExecutionMemories);
      remainingStack = impl->wasmConfig.vmOptions.max_stack_bytes;

      atrace.action    = action;
      ActionContext ac = {*this, action, atrace};
      try
      {
         auto& ec = getExecutionContext(action.service);
         ec.execServe(ac);
      }
      catch (std::exception& e)
      {
         atrace.error = e.what();
         reportError(*this, atrace);
         throw;
      }
   }
   catch (const accounting::Cancelled&)
   {
      throw TimeoutException{};
   }

   void TransactionContext::execExport(std::string_view fn,
                                       const Action&    action,
                                       ActionTrace&     atrace)
   try
   {
      // Propagate this request's budget/cancellation into synchronous storage-owner jobs.
      auto         storageAccounting = impl->watchdog->accountingScope();
      ScopedAtomic saved{impl->vmTimedOut};
      auto&        db  = blockContext.db;
      config           = db.kvGetOrDefault<ConfigRow>(ConfigRow::db, ConfigRow::key());
      impl->wasmConfig = db.kvGetOrDefault<WasmConfigRow>(
          WasmConfigRow::db, WasmConfigRow::key(transactionWasmConfigTable));
      blockContext.systemContext.setNumMemories(impl->wasmConfig.numExecutionMemories);
      remainingStack = impl->wasmConfig.vmOptions.max_stack_bytes;

      atrace.action    = action;
      ActionContext ac = {*this, action, atrace};
      try
      {
         auto& ec = getExecutionContext(action.service);
         ec.exec(ac, fn);
      }
      catch (std::exception& e)
      {
         atrace.error = e.what();
         reportError(*this, atrace);
         throw;
      }
   }
   catch (const accounting::Cancelled&)
   {
      throw TimeoutException{};
   }

   ExecutionContext& TransactionContext::getExecutionContext(AccountNumber service)
   {
      auto& executionContexts = impl->altMode ? impl->altExecContexts : impl->executionContexts;
      {
         std::lock_guard guard{impl->mutex};
         if (impl->timedOut)
            throw TimeoutException{};
         auto it = executionContexts.find(service);
         if (it != executionContexts.end())
            return it->second;
      }
      impl->watchdog->pause();
      auto resume = psio::finally{[&] { impl->watchdog->resume(); }};
      {
         // A callback may have won the manager lock just before pause().
         std::lock_guard guard{impl->mutex};
         if (impl->timedOut)
            throw TimeoutException{};
      }
      check(impl->executionContexts.size() < blockContext.systemContext.executionMemories.size(),
            "exceeded maximum number of running services");
      if (impl->executionContexts.size() + impl->altExecContexts.size() >=
          blockContext.systemContext.executionMemories.size())
      {
         if (  // It's only on replay that we need to suppress subjective errors.
             // Don't bother in speculative or block producing mode.
             !blockContext.isProducing &&
             // If we are running in altMode, it isn't safe to clear them,
             // because some alt contexts might be running. We also don't need
             // to handle it here, because the exception will be caught when
             // exiting altMode, if it's needed.
             !impl->altMode &&
             // If there are no alt contexts, clearing them won't help.
             !impl->altExecContexts.empty())
         {
            impl->clearAltExecutionContexts();
         }
         else
         {
            abortMessage("exceeded maximum number of running services");
         }
      }
      // alt modules take memories from the back, to avoid
      // interleaving with the regular modules, so they can
      // be cleared safely.
      auto  memidx = impl->altMode ? blockContext.systemContext.executionMemories.size() -
                                         impl->altExecContexts.size() - 1
                                   : impl->executionContexts.size();
      auto& memory = blockContext.systemContext.executionMemories[memidx];
      ExecutionContext             execContext{*this, impl->wasmConfig.vmOptions, memory, service};
      std::unique_lock<std::mutex> guard{impl->mutex};
      if (impl->timedOut)
         throw TimeoutException{};
      auto& result = executionContexts.insert({service, std::move(execContext)}).first->second;
      guard.unlock();
      return result;
   }

   void TransactionContextImpl::asyncTimeout()
   {
      std::lock_guard<std::mutex> guard{mutex};
      timedOut   = true;
      vmTimedOut = true;
      for (auto& [_, ec] : executionContexts)
         ec.asyncTimeout();
      for (auto& [_, ec] : altExecContexts)
         ec.asyncTimeout();
   }

   std::chrono::nanoseconds TransactionContext::getBillableTime()
   {
      return impl->watchdog->elapsed();
   }

   void TransactionContext::setWatchdog(CpuClock::duration watchdogLimit)
   {
      impl->watchdog->setLimit(watchdogLimit);
   }  // TransactionContext::setWatchdog

   const WasmConfigRow& TransactionContext::getWasmConfig() const
   {
      return impl->wasmConfig;
   }

   psizam::detail::stack_manager& TransactionContext::getAltStack()
   {
      return impl->altStack;
   }
}  // namespace psibase
