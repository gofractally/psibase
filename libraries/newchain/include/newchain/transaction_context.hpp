#pragma once

#include <newchain/block_context.hpp>

namespace newchain
{
   struct transaction_context
   {
      newchain::block_context&              block_context;
      chainbase::database::session          db_session;
      const signed_transaction&             trx;
      const std::vector<eosio::public_key>& recovered_keys;
      transaction_trace&                    trace;

      transaction_context(newchain::block_context&              block_context,
                          const signed_transaction&             trx,
                          const std::vector<eosio::public_key>& recovered_keys,
                          transaction_trace&                    trace,
                          bool                                  enable_undo);

      void exec();
   };  // block_context

}  // namespace newchain
