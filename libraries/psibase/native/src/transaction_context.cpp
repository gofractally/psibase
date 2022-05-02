#include <psibase/transaction_context.hpp>

#include <psibase/action_context.hpp>
#include <psibase/contract_entry.hpp>
#include <psio/from_bin.hpp>

namespace psibase
{
   transaction_context::transaction_context(psibase::block_context&    block_context,
                                            const SignedTransaction&   trx,
                                            psibase::TransactionTrace& transaction_trace,
                                            bool                       enable_undo)
       : block_context{block_context}, trx{trx}, transaction_trace{transaction_trace}
   {
      if (enable_undo)
         session = block_context.db.start_write();
   }

   static void exec_genesis_action(transaction_context& self, const Action& action);
   static void exec_process_transaction(transaction_context& self);
   static void exec_verify_proofs(transaction_context& self);

   void transaction_context::exec_transaction()
   {
      // Prepare for execution
      auto& db     = block_context.db;
      auto  status = db.kv_get_or_default<status_row>(status_row::kv_map, status_key());
      block_context.system_context.set_num_memories(status.num_execution_memories);

      if (block_context.need_genesis_action)
      {
         check(trx.transaction.actions.size() == 1,
               "genesis transaction must have exactly 1 action");
         exec_genesis_action(*this, trx.transaction.actions[0]);
         block_context.need_genesis_action = false;
      }
      else
      {
         exec_verify_proofs(*this);
         exec_process_transaction(*this);
      }

      // If the transaction adjusted num_execution_memories too big for this node, then attempt
      // to reject the transaction. It is possible for the node to go down in flames instead.
      status = db.kv_get_or_default<status_row>(status_row::kv_map, status_key());
      block_context.system_context.set_num_memories(status.num_execution_memories);
   }

   static void exec_genesis_action(transaction_context& self, const Action& action)
   {
      auto& atrace  = self.transaction_trace.action_traces.emplace_back();
      atrace.action = action;
      try
      {
         auto& db = self.block_context.db;
         // TODO: verify, no extra data
         auto data = psio::convert_from_frac<GenesisActionData>(
             {action.rawData.data(), action.rawData.size()});
         for (auto& contract : data.contracts)
         {
            check(contract.contract.value, "account 0 is reserved");
            check(!db.kv_get<account_row>(account_row::kv_map, account_key(contract.contract)),
                  "account already created");
            account_row account{
                .num          = contract.contract,
                .authContract = contract.authContract,
                .flags        = contract.flags,
            };
            db.kv_put(account_row::kv_map, account.key(), account);
            set_code(db, contract.contract, contract.vmType, contract.vmVersion,
                     {contract.code.data(), contract.code.size()});
         }
      }
      catch (const std::exception& e)
      {
         atrace.error = e.what();
         throw;
      }
   }

   static void exec_process_transaction(transaction_context& self)
   {
      /// TODO: move this to a common header
      static constexpr AccountNumber trxsys = AccountNumber("transact-sys");
      Action                         action{
                                  .sender   = AccountNumber(),
                                  .contract = trxsys,
                                  .rawData  = psio::convert_to_frac(self.trx.transaction),
      };
      auto& atrace  = self.transaction_trace.action_traces.emplace_back();
      atrace.action = action;  // TODO: avoid copy and redundancy between action and atrace.action
      action_context ac = {self, action, self.transaction_trace.action_traces.back()};
      auto&          ec = self.get_execution_context(trxsys);
      ec.exec_process_transaction(ac);
   }

   // TODO: disable access to db
   // TODO: parallel execution
   // TODO: separate execution memories with smaller number of max active wasms
   // TODO: separate execution_context pool for executing each proof
   // TODO: time limit
   static void exec_verify_proofs(transaction_context& self)
   {
      check(self.trx.proofs.size() == self.trx.transaction.claims.size(),
            "proofs and claims must have same size");
      // TODO: don't pack trx twice
      auto packed_trx = psio::convert_to_frac(self.trx.transaction);
      auto id         = sha256(packed_trx.data(), packed_trx.size());
      for (size_t i = 0; i < self.trx.proofs.size(); ++i)
      {
         auto&       claim = self.trx.transaction.claims[i];
         auto&       proof = self.trx.proofs[i];
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
         auto& atrace      = self.transaction_trace.action_traces.emplace_back();
         atrace.action     = action;
         action_context ac = {self, action, atrace};
         auto&          ec = self.get_execution_context(claim.contract);
         ec.exec_verify(ac);
      }
   }

   void transaction_context::exec_called_action(uint64_t      caller_flags,
                                                const Action& action,
                                                ActionTrace&  atrace)
   {
      atrace.action     = action;
      action_context ac = {*this, action, atrace};
      auto&          ec = get_execution_context(action.contract);
      ec.exec_called(caller_flags, ac);
   }

   void transaction_context::exec_rpc(const Action& action, ActionTrace& atrace)
   {
      auto& db     = block_context.db;
      auto  status = db.kv_get_or_default<status_row>(status_row::kv_map, status_key());
      block_context.system_context.set_num_memories(status.num_execution_memories);

      atrace.action     = action;
      action_context ac = {*this, action, atrace};
      auto&          ec = get_execution_context(action.contract);
      ec.exec_rpc(ac);
   }

   execution_context& transaction_context::get_execution_context(AccountNumber contract)
   {
      auto it = execution_contexts.find(contract);
      if (it != execution_contexts.end())
         return it->second;
      check(execution_contexts.size() < block_context.system_context.execution_memories.size(),
            "exceeded maximum number of running contracts");
      auto& memory = block_context.system_context.execution_memories[execution_contexts.size()];
      return execution_contexts.insert({contract, execution_context{*this, memory, contract}})
          .first->second;
   }
}  // namespace psibase
