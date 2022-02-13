#pragma once

#include <newchain/db.hpp>

namespace newchain
{
   // Note: forking must occur before a block_context is created
   struct block_context
   {
      database&                    db;
      chainbase::database::session db_session;
      const status_object&         status;
      block                        current;
      bool                         started = false;
      bool                         active  = false;

      block_context(database& db, bool enable_undo);

      void check_active() { eosio::check(active, "block is not active"); }

      void start(std::optional<eosio::time_point_sec> time);
      void start(block&& src);
      void commit();
   };  // block_context

}  // namespace newchain
