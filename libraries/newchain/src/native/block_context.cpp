#include <newchain/transaction_context.hpp>

namespace newchain
{
   block_context::block_context(newchain::system_context& system_context, bool enable_undo)
       : system_context{system_context},
         db{system_context.db},
         kv_trx{system_context.db.kv->start_write()}
   {
      eosio::check(enable_undo, "TODO: remove option");
      // Corruption detection. busy gets reset only on commit or undo.
   }

   // TODO: (or elsewhere) graceful shutdown when db size hits threshold
   void block_context::start(std::optional<eosio::time_point_sec> time)
   {
      eosio::check(!started, "block has already been started");
      auto status = db.get_kv<status_row>(kv_trx, status_key());
      if (!status)
      {
         status.emplace();
         db.set_kv(kv_trx, status->key(), *status);
      }

      if (status->head)
      {
         current.previous = status->head->id;
         current.num      = status->head->num + 1;
         if (time)
         {
            eosio::check(time->utc_seconds > status->head->time.utc_seconds,
                         "block is in the past");
            current.time = *time;
         }
         else
         {
            current.time = status->head->time + 1;
         }
      }
      else
      {
         is_genesis_block    = true;
         need_genesis_action = true;
         current.num         = 1;
         if (time)
            current.time = *time;
      }
      started = true;
      active  = true;
   }

   // TODO: (or elsewhere) check block signature
   void block_context::start(block&& src)
   {
      start(src.time);
      active = false;
      eosio::check(src.previous == current.previous, "block previous does not match expected");
      eosio::check(src.num == current.num, "block num does not match expected");
      current = std::move(src);
      active  = true;
   }

   void block_context::commit()
   {
      check_active();
      eosio::check(!need_genesis_action, "missing genesis action in block");
      active = false;

      auto status = db.get_kv<status_row>(kv_trx, status_key());
      eosio::check(status.has_value(), "missing status record");
      status->head = current;
      if (is_genesis_block)
         status->chain_id = status->head->id;
      db.set_kv(kv_trx, status->key(), *status);

      kv_trx.commit();
   }

   void block_context::push_transaction(const signed_transaction& trx,
                                        transaction_trace&        trace,
                                        bool                      enable_undo,
                                        bool                      commit)
   {
      exec(trx, trace, enable_undo, commit);
      current.transactions.push_back(std::move(trx));
   }

   void block_context::exec_all_in_block()
   {
      for (auto& trx : current.transactions)
      {
         transaction_trace trace;
         exec(trx, trace, false, true);
      }
   }

   void block_context::exec(const signed_transaction& trx,
                            transaction_trace&        trace,
                            bool                      enable_undo,
                            bool                      commit)
   {
      // TODO: recover keys
      exec(trx, {}, trace, enable_undo, commit);
   }

   // TODO: limit charged CPU & NET which can go into a block
   // TODO: duplicate detection
   void block_context::exec(const signed_transaction&             trx,
                            const std::vector<eosio::public_key>& recovered_keys,
                            transaction_trace&                    trace,
                            bool                                  enable_undo,
                            bool                                  commit)
   {
      try
      {
         check_active();
         eosio::check(enable_undo || commit, "neither enable_undo or commit is set");

         // if !enable_undo then block_context becomes unusable if transaction
         // fails. This will cascade to a busy lock (database corruption) if
         // block_context::enable_undo is also false.
         active = enable_undo;

         trace.trx = trx;
         transaction_context t{*this, trx, recovered_keys, trace, enable_undo};
         t.exec_all_actions();

         if (commit)
         {
            // TODO: limit billed time in block
            eosio::check(!(trx.flags & transaction::do_not_broadcast),
                         "cannot commit a do_not_broadcast transaction");
            if (t.nested_kv_trx)
               t.nested_kv_trx.commit();
            active = true;
         }
      }
      catch (const std::exception& e)
      {
         trace.error = e.what();
         throw;
      }
   }

}  // namespace newchain
