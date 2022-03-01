#pragma once

#include <newchain/system_context.hpp>
#include <newchain/trace.hpp>

namespace newchain
{
   struct read_only
   {
   };

   // Note: forking must occur before a block_context is created
   struct block_context
   {
      newchain::system_context& system_context;
      database                  db;
      database::session         session;
      block                     current;
      bool                      is_producing        = false;
      bool                      is_read_only        = false;
      bool                      is_genesis_block    = false;
      bool                      need_genesis_action = false;
      bool                      started             = false;
      bool                      active              = false;

      block_context(newchain::system_context& system_context, bool is_producing, bool enable_undo);
      block_context(newchain::system_context& system_context, read_only);

      void check_active() { eosio::check(active, "block is not active"); }

      void start(std::optional<eosio::time_point_sec> time = {});
      void start(block&& src);
      void commit();

      void push_transaction(const signed_transaction& trx,
                            transaction_trace&        trace,
                            bool                      enable_undo = true,
                            bool                      commit      = true);

      transaction_trace push_transaction(const signed_transaction& trx)
      {
         transaction_trace trace;
         push_transaction(trx, trace);
         return trace;
      }

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
