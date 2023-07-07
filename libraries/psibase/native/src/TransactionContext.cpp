#include <psibase/TransactionContext.hpp>

#include <condition_variable>
#include <eosio/vm/execution_context.hpp>
#include <mutex>
#include <psibase/ActionContext.hpp>
#include <psibase/Watchdog.hpp>
#include <psibase/serviceEntry.hpp>
#include <psio/from_bin.hpp>
#include <thread>

namespace psibase
{
   struct TransactionContextImpl
   {
      explicit TransactionContextImpl(SystemContext& context)
          : watchdog(*context.watchdogManager, [this] { asyncTimeout(); })
      {
      }
      void asyncTimeout();

      WasmConfigRow wasmConfig;

      // mutex protects timedOut and insertions in executionContexts
      std::mutex                                mutex    = {};
      bool                                      timedOut = false;
      eosio::vm::stack_manager                  altStack;
      std::map<AccountNumber, ExecutionContext> executionContexts = {};
      Watchdog                                  watchdog;
   };

   TransactionContext::TransactionContext(BlockContext&            blockContext,
                                          const SignedTransaction& signedTransaction,
                                          TransactionTrace&        transactionTrace,
                                          bool                     allowDbRead,
                                          bool                     allowDbWrite,
                                          bool                     allowDbReadSubjective)
       : blockContext{blockContext},
         signedTransaction{signedTransaction},
         transactionTrace{transactionTrace},
         allowDbRead{allowDbRead},
         allowDbWrite{allowDbWrite},
         allowDbReadSubjective{allowDbReadSubjective},
         impl{std::make_unique<TransactionContextImpl>(blockContext.systemContext)}
   {
   }

   TransactionContext::~TransactionContext() {}

   static void execGenesisAction(TransactionContext& self, const Action& action);
   static void execProcessTransaction(TransactionContext& self, bool checkFirstAuthAndExit);

   void TransactionContext::execTransaction()
   {
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
         execProcessTransaction(*this, false);
      }

      // If the transaction adjusted numExecutionMemories too big for this node, then attempt
      // to reject the transaction. It is possible for the node to go down in flames instead.
      impl->wasmConfig = db.kvGetOrDefault<WasmConfigRow>(
          WasmConfigRow::db, WasmConfigRow::key(transactionWasmConfigTable));
      blockContext.systemContext.setNumMemories(impl->wasmConfig.numExecutionMemories);
   }

   void TransactionContext::checkFirstAuth()
   {
      auto& db         = blockContext.db;
      config           = db.kvGetOrDefault<ConfigRow>(ConfigRow::db, ConfigRow::key());
      impl->wasmConfig = db.kvGetOrDefault<WasmConfigRow>(WasmConfigRow::db,
                                                          WasmConfigRow::key(proofWasmConfigTable));
      blockContext.systemContext.setNumMemories(impl->wasmConfig.numExecutionMemories);
      remainingStack = impl->wasmConfig.vmOptions.max_stack_bytes;

      check(!blockContext.needGenesisAction, "checkFirstAuth does not handle genesis");
      execProcessTransaction(*this, true);
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
            if (service.flags & CodeRow::isAuthService)
            {
               self.blockContext.modifiedAuthAccounts.insert({service.service, true});
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

   // TODO: eliminate extra copies
   static void execProcessTransaction(TransactionContext& self, bool checkFirstAuthAndExit)
   {
      ProcessTransactionArgs args{.transaction           = self.signedTransaction.transaction,
                                  .checkFirstAuthAndExit = checkFirstAuthAndExit};

      Action action{
          .sender  = AccountNumber(),
          .service = transactionServiceNum,
          .rawData = psio::convert_to_frac(args),
      };
      auto& atrace  = self.transactionTrace.actionTraces.emplace_back();
      atrace.action = action;  // TODO: avoid copy and redundancy between action and atrace.action
      ActionContext ac = {self, action, self.transactionTrace.actionTraces.back()};
      auto&         ec = self.getExecutionContext(transactionServiceNum);
      ec.execProcessTransaction(ac);
   }

   void TransactionContext::execVerifyProof(size_t i)
   {
      // TODO: fracpack validation, allowing new fields in inner transaction. Might be redundant elsewhere?
      auto trxView    = *signedTransaction.transaction;
      auto claimsView = trxView.claims();
      check(signedTransaction.proofs.size() == claimsView.size(),
            "proofs and claims must have same size");
      auto id = sha256(signedTransaction.transaction.data(), signedTransaction.transaction.size());
      execVerifyProof(id, claimsView[i], signedTransaction.proofs[i]);
   }

   void TransactionContext::execVerifyProof(const Checksum256& id,
                                            Claim              claim,
                                            std::vector<char>  proof)
   {
      auto& db         = blockContext.db;
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
          .rawData = psio::convert_to_frac(data),
      };
      auto& atrace     = transactionTrace.actionTraces.emplace_back();
      atrace.action    = action;
      ActionContext ac = {*this, action, atrace};
      auto&         ec = getExecutionContext(action.service);
      ec.execVerify(ac);
   }

   void TransactionContext::execNonTrxAction(uint64_t      callerFlags,
                                             const Action& action,
                                             ActionTrace&  atrace)
   {
      auto& db         = blockContext.db;
      config           = db.kvGetOrDefault<ConfigRow>(ConfigRow::db, ConfigRow::key());
      impl->wasmConfig = db.kvGetOrDefault<WasmConfigRow>(
          WasmConfigRow::db, WasmConfigRow::key(transactionWasmConfigTable));
      blockContext.systemContext.setNumMemories(impl->wasmConfig.numExecutionMemories);
      remainingStack = impl->wasmConfig.vmOptions.max_stack_bytes;

      atrace.action    = action;
      ActionContext ac = {*this, action, atrace};
      auto&         ec = getExecutionContext(action.service);
      ec.execCalled(callerFlags, ac);
   }

   void TransactionContext::execCalledAction(uint64_t      callerFlags,
                                             const Action& action,
                                             ActionTrace&  atrace)
   {
      atrace.action    = action;
      ActionContext ac = {*this, action, atrace};
      auto&         ec = getExecutionContext(action.service);
      ec.execCalled(callerFlags, ac);
   }

   // TODO: different wasmConfig, controlled by config file
   void TransactionContext::execServe(const Action& action, ActionTrace& atrace)
   {
      auto& db         = blockContext.db;
      config           = db.kvGetOrDefault<ConfigRow>(ConfigRow::db, ConfigRow::key());
      impl->wasmConfig = db.kvGetOrDefault<WasmConfigRow>(
          WasmConfigRow::db, WasmConfigRow::key(transactionWasmConfigTable));
      blockContext.systemContext.setNumMemories(impl->wasmConfig.numExecutionMemories);
      remainingStack = impl->wasmConfig.vmOptions.max_stack_bytes;

      atrace.action    = action;
      ActionContext ac = {*this, action, atrace};
      auto&         ec = getExecutionContext(action.service);
      ec.execServe(ac);
   }

   ExecutionContext& TransactionContext::getExecutionContext(AccountNumber service)
   {
      auto it = impl->executionContexts.find(service);
      if (it != impl->executionContexts.end())
         return it->second;
      impl->watchdog.pause();
      check(impl->executionContexts.size() < blockContext.systemContext.executionMemories.size(),
            "exceeded maximum number of running services");
      auto& memory = blockContext.systemContext.executionMemories[impl->executionContexts.size()];
      ExecutionContext            execContext{*this, impl->wasmConfig.vmOptions, memory, service};
      std::lock_guard<std::mutex> guard{impl->mutex};
      if (impl->timedOut)
         throw TimeoutException{};
      auto& result =
          impl->executionContexts.insert({service, std::move(execContext)}).first->second;
      impl->watchdog.resume();
      return result;
   }

   void TransactionContextImpl::asyncTimeout()
   {
      std::lock_guard<std::mutex> guard{mutex};
      timedOut = true;
      for (auto& [_, ec] : executionContexts)
         ec.asyncTimeout();
   }

   std::chrono::nanoseconds TransactionContext::getBillableTime()
   {
      return impl->watchdog.elapsed();
   }

   void TransactionContext::setWatchdog(std::chrono::steady_clock::duration watchdogLimit)
   {
      impl->watchdog.setLimit(watchdogLimit);
   }  // TransactionContext::setWatchdog

   eosio::vm::stack_manager& TransactionContext::getAltStack()
   {
      return impl->altStack;
   }
}  // namespace psibase
