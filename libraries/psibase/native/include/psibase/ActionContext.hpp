#pragma once

#include <psibase/TransactionContext.hpp>

namespace psibase
{
   struct ActionContext
   {
      TransactionContext& transactionContext;
      const Action&       action;
      ActionTrace&        actionTrace;
      std::size_t         subjectiveDepth = transactionContext.blockContext.db.saveSubjective();
      ~ActionContext() { transactionContext.blockContext.db.restoreSubjective(subjectiveDepth); }
   };

}  // namespace psibase
