#include <newchain/block_context.hpp>

namespace newchain
{
   static const status_object& load_status(database& db)
   {
      if (auto* obj = db.db.find<status_object>())
         return *obj;
      return db.db.create<status_object>([](auto&) {});
   }

   block_context::block_context(database& db, bool enable_undo)
       : db{db}, db_session{db.db.start_undo_session(enable_undo)}, status{load_status(db)}
   {
   }

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
      db.db.modify(status, [&](auto& status) { status.head = current; });
      db_session.push();
   }

}  // namespace newchain
