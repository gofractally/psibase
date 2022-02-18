#pragma once

#include <newchain/transaction_context.hpp>

namespace newchain
{
   struct action_context
   {
      newchain::transaction_context& transaction_context;
      const newchain::action&        action;
      newchain::action_trace&        action_trace;

      action_context(newchain::transaction_context& transaction_context,
                     const newchain::action&        action,
                     newchain::action_trace&        action_trace);

      void exec(bool is_auth = false);
   };  // action_context

}  // namespace newchain
