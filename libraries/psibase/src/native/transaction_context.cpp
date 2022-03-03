#include <psibase/transaction_context.hpp>

#include <eosio/from_bin.hpp>
#include <psibase/action_context.hpp>
#include <psibase/from_bin.hpp>

namespace psibase
{
   transaction_context::transaction_context(psibase::block_context&               block_context,
                                            const signed_transaction&             trx,
                                            const std::vector<eosio::public_key>& recovered_keys,
                                            psibase::transaction_trace&           transaction_trace,
                                            bool                                  enable_undo)
       : block_context{block_context},
         trx{trx},
         recovered_keys{recovered_keys},
         transaction_trace{transaction_trace}
   {
      if (enable_undo)
         session = block_context.db.start_write();
   }

   static void exec_genesis_action(transaction_context& self, const action& act);
   static void exec_process_transaction(transaction_context& self);

   void transaction_context::exec_transaction()
   {
      // TODO: move checks into wasm
      eosio::check(block_context.current.time < trx.expiration, "transaction expired");
      eosio::check(!trx.actions.empty(), "transaction has no actions");

      // Prepare for execution
      auto& db     = block_context.db;
      auto  status = db.kv_get_or_default<status_row>(status_row::kv_map, status_key());
      block_context.system_context.set_num_memories(status.num_execution_memories);

      if (block_context.need_genesis_action)
      {
         eosio::check(trx.actions.size() == 1, "genesis transaction must have exactly 1 action");
         exec_genesis_action(*this, trx.actions[0]);
         block_context.need_genesis_action = false;
      }
      else
      {
         exec_process_transaction(*this);
      }

      // If the transaction adjusted num_execution_memories too big for this node, then attempt
      // to reject the transaction. It is possible for the node to go down in flames instead.
      status = db.kv_get_or_default<status_row>(status_row::kv_map, status_key());
      block_context.system_context.set_num_memories(status.num_execution_memories);
   }

   static void exec_genesis_action(transaction_context& self, const action& act)
   {
      auto& atrace = self.transaction_trace.action_traces.emplace_back();
      atrace.act   = act;
      try
      {
         auto& db   = self.block_context.db;
         auto  data = unpack_all<genesis_action_data>({act.raw_data.data(), act.raw_data.size()},
                                                     "extra data in genesis payload");
         for (auto& contract : data.contracts)
         {
            eosio::check(contract.contract, "account 0 is reserved");
            eosio::check(
                !db.kv_get<account_row>(account_row::kv_map, account_key(contract.contract)),
                "account already created");
            account_row account{
                .num           = contract.contract,
                .auth_contract = contract.auth_contract,
                .flags         = contract.flags,
            };
            db.kv_put(account_row::kv_map, account.key(), account);
            set_code(db, contract.contract, contract.vm_type, contract.vm_version,
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
      action act{
          .sender   = 0,
          .contract = 1,
          .raw_data = eosio::convert_to_bin(self.trx),
      };
      auto& atrace      = self.transaction_trace.action_traces.emplace_back();
      atrace.act        = act;  // TODO: avoid copy and redundancy between act and atrace.act
      action_context ac = {self, act, self.transaction_trace.action_traces.back()};
      auto&          ec = self.get_execution_context(1);
      ec.exec_process_transaction(ac);
   }

   void transaction_context::exec_called_action(uint64_t      caller_flags,
                                                const action& act,
                                                action_trace& atrace)
   {
      atrace.act        = act;
      action_context ac = {*this, act, atrace};
      auto&          ec = get_execution_context(act.contract);
      ec.exec_called(caller_flags, ac);
   }

   void transaction_context::exec_rpc(const action& act, action_trace& atrace)
   {
      auto& db     = block_context.db;
      auto  status = db.kv_get_or_default<status_row>(status_row::kv_map, status_key());
      block_context.system_context.set_num_memories(status.num_execution_memories);

      atrace.act        = act;
      action_context ac = {*this, act, atrace};
      auto&          ec = get_execution_context(act.contract);
      ec.exec_rpc(ac);
   }

   execution_context& transaction_context::get_execution_context(account_num contract)
   {
      auto it = execution_contexts.find(contract);
      if (it != execution_contexts.end())
         return it->second;
      eosio::check(
          execution_contexts.size() < block_context.system_context.execution_memories.size(),
          "exceeded maximum number of running contracts");
      auto& memory = block_context.system_context.execution_memories[execution_contexts.size()];
      return execution_contexts.insert({contract, execution_context{*this, memory, contract}})
          .first->second;
   }
}  // namespace psibase
