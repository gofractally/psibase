#pragma once

#include <psibase/TransactionContext.hpp>

namespace psibase
{
   struct ActionContext
   {
      TransactionContext& transactionContext;
      const Action&       action;
      ActionTrace&        actionTrace;
      std::size_t         subjectiveDepth = transactionContext.blockContext.kv.saveSubjective();
      ~ActionContext() { transactionContext.blockContext.kv.restoreSubjective(subjectiveDepth); }
   };

}  // namespace psibase
