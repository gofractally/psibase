#include <newchain/action_context.hpp>

#include <eosio/from_bin.hpp>

namespace newchain
{
   transaction_context::transaction_context(newchain::block_context&              block_context,
                                            const signed_transaction&             trx,
                                            const std::vector<eosio::public_key>& recovered_keys,
                                            newchain::transaction_trace&          transaction_trace,
                                            bool                                  enable_undo)
       : block_context{block_context},
         db_session{block_context.db.db.start_undo_session(enable_undo)},
         trx{trx},
         recovered_keys{recovered_keys},
         transaction_trace{transaction_trace}
   {
   }

   static void exec_genesis_action(transaction_context& self, const action& act)
   {
      auto&               db = self.block_context.db;
      genesis_action_data data;
      eosio::input_stream s{act.raw_data.data(), act.raw_data.size()};
      from_bin(data, s);
      eosio::check(!s.remaining(), "extra data in genesis payload");
      eosio::check(data.contract == 1, "genesis contract must be 1");

      db.db.remove(db.db.create<account_object>([](auto&) {}));
      db.db.create<account_object>([](auto&) {});
      set_code(db, data.contract, data.vm_type, data.vm_version,
               {data.code.data(), data.code.size()});
   }

   static void exec_action(transaction_context& self, const action& act)
   {
      auto& db     = self.block_context.db;
      auto* sender = db.db.find(account_object::id_type(act.sender));
      eosio::check(sender, "unknown sender account");

      action auth_action{
          .sender   = 0,
          .contract = sender->auth_contract,
          .act      = auth_action_num,
          .raw_data = eosio::convert_to_bin(act),
      };

      self.transaction_trace.action_traces.emplace_back();
      action_context ac{self, auth_action, self.transaction_trace.action_traces.back()};
      ac.exec();
   }

   // TODO: limit execution time when not playing a produced block
   // TODO: charge net and cpu
   // TODO: check ref_block_num, ref_block_prefix
   // TODO: check max_net_usage_words, max_cpu_usage_ms
   void transaction_context::exec()
   {
      eosio::check(trx.expiration < block_context.current.time, "transaction expired");
      eosio::check(!trx.actions.empty(), "transaction has no actions");

      // Prepare for execution
      block_context.system_context.set_num_memories(block_context.status.num_execution_memories);

      for (auto& act : trx.actions)
         if (block_context.is_genesis_block && &act == &trx.actions[0])
            exec_genesis_action(*this, act);
         else
            exec_action(*this, act);

      // If the transaction adjusted num_execution_memories too big for this node, then attempt
      // to reject the transaction. It is possible for the node to go down in flames instead.
      block_context.system_context.set_num_memories(block_context.status.num_execution_memories);
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
}  // namespace newchain
