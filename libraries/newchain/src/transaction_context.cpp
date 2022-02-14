#include <newchain/transaction_context.hpp>

namespace newchain
{
   transaction_context::transaction_context(newchain::block_context&              block_context,
                                            const signed_transaction&             trx,
                                            const std::vector<eosio::public_key>& recovered_keys,
                                            transaction_trace&                    trace,
                                            bool                                  enable_undo)
       : block_context{block_context},
         db_session{block_context.db.db.start_undo_session(enable_undo)},
         trx{trx},
         recovered_keys{recovered_keys},
         trace{trace}
   {
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

      for (auto& action : trx.actions)
      {
         // TODO
      }

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
