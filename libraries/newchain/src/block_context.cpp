#include <newchain/transaction_context.hpp>

namespace newchain
{
   static const status_object& load_status(database& db)
   {
      if (auto* obj = db.db.find<status_object>())
         return *obj;
      return db.db.create<status_object>([](auto&) {});
   }

   block_context::block_context(newchain::system_context& system_context, bool enable_undo)
       : system_context{system_context},
         db{system_context.db},
         db_session{db.db.start_undo_session(enable_undo)},
         status{load_status(db)}
   {
      // Corruption detection. busy gets reset only on commit or undo.
      eosio::check(!status.busy,
                   "Can not create a block_context on busy chain. Most likely database was "
                   "corrupted by a replay failure when optimizations were enabled.");
      db.db.modify(status, [](auto& status) { status.busy = true; });
   }

   // TODO: (or elsewhere) graceful shutdown when db size hits threshold
   void block_context::start(std::optional<eosio::time_point_sec> time)
   {
      eosio::check(!started, "block has already been started");
      if (status.head)
      {
         current.previous = status.head->id;
         current.num      = status.head->num + 1;
         if (time)
         {
            eosio::check(time->utc_seconds > status.head->time.utc_seconds, "block is in the past");
            current.time = *time;
         }
         else
         {
            current.time = status.head->time + 1;
         }
      }
      else
      {
         current.num = 1;
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
      active = false;
      db.db.modify(status, [&](auto& status) {
         status.head = current;
         status.busy = false;
      });
      db_session.push();
   }

   void block_context::push_transaction(signed_transaction&& trx,
                                        transaction_trace&   trace,
                                        bool                 enable_undo,
                                        bool                 commit)
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

   void block_context::exec(const signed_transaction&             trx,
                            const std::vector<eosio::public_key>& recovered_keys,
                            transaction_trace&                    trace,
                            bool                                  enable_undo,
                            bool                                  commit)
   {
      check_active();
      eosio::check(enable_undo || commit, "neither enable_undo or commit is set");

      // if !enable_undo then block_context becomes unusable if transaction
      // fails. This will cascade to a busy lock (database corruption) if
      // block_context::enable_undo is also false.
      active = enable_undo;

      transaction_context t{*this, trx, recovered_keys, trace, enable_undo};
      t.exec();

      if (commit)
      {
         // TODO: limit billed time in block
         eosio::check(!(trx.flags & transaction::do_not_broadcast),
                      "cannot commit a do_not_broadcast transaction");
         t.db_session.squash();
         active = true;
      }
   }

}  // namespace newchain
