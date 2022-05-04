#pragma once

#include <psibase/TransactionContext.hpp>

namespace psibase
{
   struct ActionContext
   {
      TransactionContext& transactionContext;
      const Action&       action;
      ActionTrace&        actionTrace;
   };

}  // namespace psibase
