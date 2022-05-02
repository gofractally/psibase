#pragma once

#include <psibase/transaction_context.hpp>

namespace psibase
{
   struct action_context
   {
      psibase::transaction_context& transaction_context;
      const psibase::Action&        action;
      psibase::action_trace&        action_trace;
   };  // action_context

}  // namespace psibase
