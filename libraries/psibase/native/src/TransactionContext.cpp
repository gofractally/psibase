#include <psibase/TransactionContext.hpp>

#include <mutex>
#include <psibase/ActionContext.hpp>
#include <psibase/contract_entry.hpp>
#include <psio/from_bin.hpp>

namespace psibase
{
   struct TransactionContextImpl
   {
      std::mutex                                mutex;
      bool                                      ecCanceled = false;
      std::map<AccountNumber, ExecutionContext> executionContexts;
      std::chrono::steady_clock::duration       contractLoadTime{0};
   };

   TransactionContext::TransactionContext(BlockContext&            blockContext,
                                          const SignedTransaction& signedTransaction,
                                          TransactionTrace&        transactionTrace,
                                          bool                     enableUndo)
       : blockContext{blockContext},
         signedTransaction{signedTransaction},
         transactionTrace{transactionTrace},
         startTime{std::chrono::steady_clock::now()},
         impl{std::make_unique<TransactionContextImpl>()}
   {
      if (enableUndo)
         session = blockContext.db.startWrite();
   }

   TransactionContext::~TransactionContext() {}

   static void execGenesisAction(TransactionContext& self, const Action& action);
   static void execProcessTransaction(TransactionContext& self);
   static void execVerifyProofs(TransactionContext& self);

   void TransactionContext::execTransaction()
   {
      // Prepare for execution
      auto& db     = blockContext.db;
      auto  status = db.kvGetOrDefault<status_row>(status_row::kv_map, status_key());
      blockContext.systemContext.setNumMemories(status.num_execution_memories);

      if (blockContext.needGenesisAction)
      {
         check(signedTransaction.transaction.actions.size() == 1,
               "genesis transaction must have exactly 1 action");
         execGenesisAction(*this, signedTransaction.transaction.actions[0]);
         blockContext.needGenesisAction = false;
      }
      else
      {
         execVerifyProofs(*this);
         execProcessTransaction(*this);
      }

      // If the transaction adjusted num_execution_memories too big for this node, then attempt
      // to reject the transaction. It is possible for the node to go down in flames instead.
      status = db.kvGetOrDefault<status_row>(status_row::kv_map, status_key());
      blockContext.systemContext.setNumMemories(status.num_execution_memories);
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
            check(!db.kvGet<account_row>(account_row::kv_map, account_key(contract.contract)),
                  "account already created");
            account_row account{
                .num          = contract.contract,
                .authContract = contract.authContract,
                .flags        = contract.flags,
            };
            db.kvPut(account_row::kv_map, account.key(), account);
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

   static void execProcessTransaction(TransactionContext& self)
   {
      /// TODO: move this to a common header
      static constexpr AccountNumber trxsys = AccountNumber("transact-sys");
      Action                         action{
                                  .sender   = AccountNumber(),
                                  .contract = trxsys,
                                  .rawData = psio::convert_to_frac(self.signedTransaction.transaction),
      };
      auto& atrace  = self.transactionTrace.actionTraces.emplace_back();
      atrace.action = action;  // TODO: avoid copy and redundancy between action and atrace.action
      ActionContext ac = {self, action, self.transactionTrace.actionTraces.back()};
      auto&         ec = self.getExecutionContext(trxsys);
      ec.execProcessTransaction(ac);
   }

   // TODO: disable access to db
   // TODO: parallel execution
   // TODO: separate execution memories with smaller number of max active wasms
   // TODO: separate ExecutionContext pool for executing each proof
   // TODO: separate time limits for proofs?
   // TODO: provide execution time to subjective contract, separated from rest of execution time
   static void execVerifyProofs(TransactionContext& self)
   {
      check(
          self.signedTransaction.proofs.size() == self.signedTransaction.transaction.claims.size(),
          "proofs and claims must have same size");
      // TODO: don't pack transaction twice
      auto packed_trx = psio::convert_to_frac(self.signedTransaction.transaction);
      auto id         = sha256(packed_trx.data(), packed_trx.size());
      for (size_t i = 0; i < self.signedTransaction.proofs.size(); ++i)
      {
         auto&       claim = self.signedTransaction.transaction.claims[i];
         auto&       proof = self.signedTransaction.proofs[i];
         verify_data data{
             .transaction_hash = id,
             .claim            = claim,
             .proof            = proof,
         };
         Action action{
             .sender   = {},
             .contract = claim.contract,
             .rawData  = psio::convert_to_frac(data),
         };
         auto& atrace     = self.transactionTrace.actionTraces.emplace_back();
         atrace.action    = action;
         ActionContext ac = {self, action, atrace};
         auto&         ec = self.getExecutionContext(claim.contract);
         ec.execVerify(ac);
      }
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
      auto  status = db.kvGetOrDefault<status_row>(status_row::kv_map, status_key());
      blockContext.systemContext.setNumMemories(status.num_execution_memories);

      atrace.action    = action;
      ActionContext ac = {*this, action, atrace};
      auto&         ec = getExecutionContext(action.contract);
      ec.execServe(ac);
   }

   ExecutionContext& TransactionContext::getExecutionContext(AccountNumber contract)
   {
      auto                        loadStart = std::chrono::steady_clock::now();
      std::lock_guard<std::mutex> guard{impl->mutex};
      if (impl->ecCanceled)
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
      // TODO: adjust watchdog
      return result;
   }

   std::chrono::steady_clock::duration TransactionContext::getContractLoadTime()
   {
      std::lock_guard<std::mutex> guard{impl->mutex};
      return impl->contractLoadTime;
   }

   void TransactionContext::setWatchdog(std::chrono::steady_clock::duration watchdogLimit)
   {
      // TODO
   }

   void TransactionContext::asyncTimeout()
   {
      std::lock_guard<std::mutex> guard{impl->mutex};
      impl->ecCanceled = true;
      for (auto& [_, ec] : impl->executionContexts)
         ec.asyncTimeout();
   }
}  // namespace psibase
