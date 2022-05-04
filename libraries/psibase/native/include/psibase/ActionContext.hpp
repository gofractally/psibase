#pragma once

#include <psibase/TransactionContext.hpp>

namespace psibase
{
   struct ActionContext
   {
      transaction_context& transactionContext;
      const Action&        action;
      ActionTrace&         actionTrace;
   };

}  // namespace psibase
