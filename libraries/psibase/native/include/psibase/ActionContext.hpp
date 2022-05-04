#pragma once

#include <psibase/TransactionContext.hpp>

namespace psibase
{
   struct ActionContext
   {
      psibase::transaction_context& transactionContext;
      const psibase::Action&        action;
      psibase::ActionTrace&         actionTrace;
   };

}  // namespace psibase
