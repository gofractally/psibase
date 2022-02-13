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
      for (auto& action : trx.actions)
      {
         // TODO
      }
   }

}  // namespace newchain
