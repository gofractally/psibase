#pragma once

#include <newchain/system_context.hpp>
#include <newchain/trace.hpp>

namespace newchain
{
   // Note: forking must occur before a block_context is created
   struct block_context
   {
      newchain::system_context&    system_context;
      database&                    db;
      chainbase::database::session db_session;
      const status_object&         status;
      block                        current;
      bool                         started = false;
      bool                         active  = false;

      block_context(newchain::system_context& system_context, bool enable_undo);

      void check_active() { eosio::check(active, "block is not active"); }

      void start(std::optional<eosio::time_point_sec> time);
      void start(block&& src);
      void commit();

      void push_transaction(signed_transaction&& trx,
                            transaction_trace&   trace,
                            bool                 enable_undo = true,
                            bool                 commit      = true);

      void exec_all_in_block();

      void exec(const signed_transaction& trx,
                transaction_trace&        trace,
                bool                      enable_undo,
                bool                      commit);

      void exec(const signed_transaction&             trx,
                const std::vector<eosio::public_key>& recovered_keys,
                transaction_trace&                    trace,
                bool                                  enable_undo,
                bool                                  commit);
   };  // block_context

}  // namespace newchain
