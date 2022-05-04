#pragma once

#include <psibase/TransactionContext.hpp>

namespace psibase
{
   struct action_context
   {
      psibase::transaction_context& transaction_context;
      const psibase::Action&        action;
      psibase::ActionTrace&         action_trace;
   };  // action_context

}  // namespace psibase
