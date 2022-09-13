#include <psibase/TransactionContext.hpp>

#include <condition_variable>
#include <mutex>
#include <psibase/ActionContext.hpp>
#include <psibase/serviceEntry.hpp>
#include <psio/from_bin.hpp>
#include <thread>

namespace psibase
{
   // TODO: spawn timeout thread once per block instead of once per trx
   struct TransactionContextImpl
   {
      WasmConfigRow wasmConfig;

      // mutex protects everything below
      std::mutex                                mutex             = {};
      std::condition_variable                   cond              = {};
      std::thread                               thread            = {};
      bool                                      timedOut          = false;
      bool                                      shuttingDown      = false;
      std::map<AccountNumber, ExecutionContext> executionContexts = {};
      std::chrono::steady_clock::duration       watchdogLimit{0};
      std::chrono::steady_clock::duration       serviceLoadTime{0};
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
         startTime{std::chrono::steady_clock::now()},
         allowDbRead{allowDbRead},
         allowDbWrite{allowDbWrite},
         allowDbReadSubjective{allowDbReadSubjective},
         impl{std::make_unique<TransactionContextImpl>()}
   {
   }

   TransactionContext::~TransactionContext()
   {
      std::unique_lock<std::mutex> lock{impl->mutex};
      if (impl->thread.joinable())
      {
         impl->shuttingDown = true;
         impl->cond.notify_one();
         lock.unlock();
         impl->thread.join();
      }
   }

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

      if (blockContext.needGenesisAction)
      {
         // TODO: full fracpack validate, no unknown, recursive
         //       might be redundant elsewhere?
         auto trxView     = *signedTransaction.transaction;
         auto actionsView = *trxView.actions();
         check(actionsView.size() == 1, "genesis transaction must have exactly 1 action");
         execGenesisAction(*this, actionsView[0].get());
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

      check(!blockContext.needGenesisAction, "checkFirstAuth does not handle genesis");
      execProcessTransaction(*this, true);
   }

   static void execGenesisAction(TransactionContext& self, const Action& action)
   {
      auto& atrace  = self.transactionTrace.actionTraces.emplace_back();
      atrace.action = action;
      try
      {
         auto& db = self.blockContext.db;
         // TODO: verify, no extra data
         auto data = psio::convert_from_frac<GenesisActionData>(
             {action.rawData.data(), action.rawData.size()});
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
      auto& db         = blockContext.db;
      config           = db.kvGetOrDefault<ConfigRow>(ConfigRow::db, ConfigRow::key());
      impl->wasmConfig = db.kvGetOrDefault<WasmConfigRow>(WasmConfigRow::db,
                                                          WasmConfigRow::key(proofWasmConfigTable));
      blockContext.systemContext.setNumMemories(impl->wasmConfig.numExecutionMemories);

      // TODO: fracpack validation, allowing new fields in inner transaction. Might be redundant elsewhere?
      auto trxView    = *signedTransaction.transaction;
      auto claimsView = *trxView.claims();
      check(signedTransaction.proofs.size() == claimsView.size(),
            "proofs and claims must have same size");
      auto  id = sha256(signedTransaction.transaction.data(), signedTransaction.transaction.size());
      auto& proof = signedTransaction.proofs[i];
      VerifyArgs data{
          .transactionHash = id,
          .claim           = claimsView[i],
          .proof           = proof,
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

   void TransactionContext::execVerifyProof(const Checksum256& id,
                                            Claim              claim,
                                            std::vector<char>  proof)
   {
      auto& db         = blockContext.db;
      config           = db.kvGetOrDefault<ConfigRow>(ConfigRow::db, ConfigRow::key());
      impl->wasmConfig = db.kvGetOrDefault<WasmConfigRow>(WasmConfigRow::db,
                                                          WasmConfigRow::key(proofWasmConfigTable));
      blockContext.systemContext.setNumMemories(impl->wasmConfig.numExecutionMemories);

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

      atrace.action    = action;
      ActionContext ac = {*this, action, atrace};
      auto&         ec = getExecutionContext(action.service);
      ec.execServe(ac);
   }

   ExecutionContext& TransactionContext::getExecutionContext(AccountNumber service)
   {
      auto                        loadStart = std::chrono::steady_clock::now();
      std::lock_guard<std::mutex> guard{impl->mutex};
      if (impl->timedOut)
         throw TimeoutException{};
      auto it = impl->executionContexts.find(service);
      if (it != impl->executionContexts.end())
         return it->second;
      check(impl->executionContexts.size() < blockContext.systemContext.executionMemories.size(),
            "exceeded maximum number of running services");
      auto& memory = blockContext.systemContext.executionMemories[impl->executionContexts.size()];
      auto& result = impl->executionContexts
                         .insert({service, ExecutionContext{*this, impl->wasmConfig.vmOptions,
                                                            memory, service}})
                         .first->second;
      impl->serviceLoadTime += std::chrono::steady_clock::now() - loadStart;
      return result;
   }

   std::chrono::nanoseconds TransactionContext::getBillableTime()
   {
      std::lock_guard<std::mutex> guard{impl->mutex};
      return std::chrono::duration_cast<std::chrono::nanoseconds>(
          std::chrono::steady_clock::now() - startTime - impl->serviceLoadTime);
   }

   void TransactionContext::setWatchdog(std::chrono::steady_clock::duration watchdogLimit)
   {
      std::lock_guard<std::mutex> guard{impl->mutex};
      impl->watchdogLimit = watchdogLimit;
      if (impl->thread.joinable())
      {
         impl->cond.notify_one();
      }
      else
      {
         impl->thread = std::thread(
             [this]
             {
                std::unique_lock<std::mutex> lock{impl->mutex};
                while (true)
                {
                   if (impl->timedOut || impl->shuttingDown)
                      return;
                   auto timeSpent =
                       std::chrono::steady_clock::now() - startTime - impl->serviceLoadTime;
                   if (timeSpent >= impl->watchdogLimit)
                   {
                      impl->timedOut = true;
                      for (auto& [_, ec] : impl->executionContexts)
                         ec.asyncTimeout();
                      return;
                   }
                   impl->cond.wait_for(lock, impl->watchdogLimit - timeSpent);
                }
             });
      }
   }  // TransactionContext::setWatchdog
}  // namespace psibase
