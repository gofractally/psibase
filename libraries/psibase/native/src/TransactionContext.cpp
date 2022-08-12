#include <psibase/TransactionContext.hpp>

#include <condition_variable>
#include <mutex>
#include <psibase/ActionContext.hpp>
#include <psibase/contractEntry.hpp>
#include <psio/from_bin.hpp>

namespace psibase
{
   // TODO: spawn timeout thread once per block instead of once per trx
   struct TransactionContextImpl
   {
      std::mutex                                mutex             = {};
      std::condition_variable                   cond              = {};
      std::thread                               thread            = {};
      bool                                      timedOut          = false;
      bool                                      shuttingDown      = false;
      std::map<AccountNumber, ExecutionContext> executionContexts = {};
      std::chrono::steady_clock::duration       watchdogLimit{0};
      std::chrono::steady_clock::duration       contractLoadTime{0};
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
      auto& db     = blockContext.db;
      auto  status = db.kvGetOrDefault<StatusRow>(StatusRow::db, statusKey());
      blockContext.systemContext.setNumMemories(status.numExecutionMemories);

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
      status = db.kvGetOrDefault<StatusRow>(StatusRow::db, statusKey());
      blockContext.systemContext.setNumMemories(status.numExecutionMemories);
   }

   void TransactionContext::checkFirstAuth()
   {
      auto& db     = blockContext.db;
      auto  status = db.kvGetOrDefault<StatusRow>(StatusRow::db, statusKey());

      // TODO: different limit since this will execute in background threads
      blockContext.systemContext.setNumMemories(status.numExecutionMemories);

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
         for (auto& contract : data.contracts)
         {
            check(contract.contract.value, "account 0 is reserved");
            check(!db.kvGet<CodeRow>(CodeRow::db, codeKey(contract.contract)),
                  "account already created");
            CodeRow account{
                .codeNum = contract.contract,
                .flags   = contract.flags,
            };
            db.kvPut(CodeRow::db, account.key(), account);
            setCode(db, contract.contract, contract.vmType, contract.vmVersion,
                    {contract.code.data(), contract.code.size()});
         }
      }
      catch (const std::exception& e)
      {
         atrace.error = e.what();
         throw;
      }
   }

   static void execProcessTransaction(TransactionContext& self, bool checkFirstAuthAndExit)
   {
      Action action{
          .sender   = AccountNumber(),
          .contract = transactionContractNum,
          .rawData  = {self.signedTransaction.transaction.data(),
                      self.signedTransaction.transaction.data() +
                          self.signedTransaction.transaction.size()},
      };
      auto& atrace  = self.transactionTrace.actionTraces.emplace_back();
      atrace.action = action;  // TODO: avoid copy and redundancy between action and atrace.action
      ActionContext ac = {self, action, self.transactionTrace.actionTraces.back()};
      auto&         ec = self.getExecutionContext(transactionContractNum);
      ec.execProcessTransaction(ac, checkFirstAuthAndExit);
   }

   void TransactionContext::execVerifyProof(size_t i)
   {
      auto& db     = blockContext.db;
      auto  status = db.kvGetOrDefault<StatusRow>(StatusRow::db, statusKey());

      // TODO: separate config for proof execution
      blockContext.systemContext.setNumMemories(status.numExecutionMemories);

      // TODO: fracpack validation, allowing new fields in inner transaction. Might be redundant elsewhere?
      auto trxView    = *signedTransaction.transaction;
      auto claimsView = *trxView.claims();
      check(signedTransaction.proofs.size() == claimsView.size(),
            "proofs and claims must have same size");
      auto  id = sha256(signedTransaction.transaction.data(), signedTransaction.transaction.size());
      auto& proof = signedTransaction.proofs[i];
      VerifyData data{
          .transactionHash = id,
          .claim           = claimsView[i],
          .proof           = proof,
      };
      Action action{
          .sender   = {},
          .contract = data.claim.contract,
          .rawData  = psio::convert_to_frac(data),
      };
      auto& atrace     = transactionTrace.actionTraces.emplace_back();
      atrace.action    = action;
      ActionContext ac = {*this, action, atrace};
      auto&         ec = getExecutionContext(action.contract);
      ec.execVerify(ac);
   }

   void TransactionContext::execNonTrxAction(uint64_t      callerFlags,
                                             const Action& action,
                                             ActionTrace&  atrace)
   {
      auto& db     = blockContext.db;
      auto  status = db.kvGetOrDefault<StatusRow>(StatusRow::db, statusKey());
      blockContext.systemContext.setNumMemories(status.numExecutionMemories);

      atrace.action    = action;
      ActionContext ac = {*this, action, atrace};
      auto&         ec = getExecutionContext(action.contract);
      ec.execCalled(callerFlags, ac);
   }

   void TransactionContext::execCalledAction(uint64_t      callerFlags,
                                             const Action& action,
                                             ActionTrace&  atrace)
   {
      atrace.action    = action;
      ActionContext ac = {*this, action, atrace};
      auto&         ec = getExecutionContext(action.contract);
      ec.execCalled(callerFlags, ac);
   }

   void TransactionContext::execServe(const Action& action, ActionTrace& atrace)
   {
      auto& db     = blockContext.db;
      auto  status = db.kvGetOrDefault<StatusRow>(StatusRow::db, statusKey());
      blockContext.systemContext.setNumMemories(status.numExecutionMemories);

      atrace.action    = action;
      ActionContext ac = {*this, action, atrace};
      auto&         ec = getExecutionContext(action.contract);
      ec.execServe(ac);
   }

   ExecutionContext& TransactionContext::getExecutionContext(AccountNumber contract)
   {
      auto                        loadStart = std::chrono::steady_clock::now();
      std::lock_guard<std::mutex> guard{impl->mutex};
      if (impl->timedOut)
         throw TimeoutException{};
      auto it = impl->executionContexts.find(contract);
      if (it != impl->executionContexts.end())
         return it->second;
      check(impl->executionContexts.size() < blockContext.systemContext.executionMemories.size(),
            "exceeded maximum number of running contracts");
      auto& memory = blockContext.systemContext.executionMemories[impl->executionContexts.size()];
      auto& result =
          impl->executionContexts.insert({contract, ExecutionContext{*this, memory, contract}})
              .first->second;
      impl->contractLoadTime += std::chrono::steady_clock::now() - loadStart;
      return result;
   }

   std::chrono::nanoseconds TransactionContext::getBillableTime()
   {
      std::lock_guard<std::mutex> guard{impl->mutex};
      return std::chrono::duration_cast<std::chrono::nanoseconds>(
          std::chrono::steady_clock::now() - startTime - impl->contractLoadTime);
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
                       std::chrono::steady_clock::now() - startTime - impl->contractLoadTime;
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
