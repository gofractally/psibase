#include "subjective-service.hpp"

#include <psibase/dispatch.hpp>

struct SubjectiveTransaction
{
   SubjectiveTransaction() { psibase::checkoutSubjective(); }
   ~SubjectiveTransaction()
   {
      if (!done)
      {
         psibase::abortSubjective();
      }
   }
   void commit()
   {
      if (!done)
      {
         done = psibase::commitSubjective();
      }
   }
   bool done = false;
};

// PSIBASE_SUBJECTIVE_TX stmt
//
// The statement will be executed one or more times until
// it is successfully committed.
//
// Unstructured control flow that exits the statement, including break,
// return, and exceptions, will discard any changes made to the
// subjective database.
//
#define PSIBASE_SUBJECTIVE_TX \
   for (::SubjectiveTransaction _psibase_s_tx; !_psibase_s_tx.done; _psibase_s_tx.commit())

void SubjectiveService::write(std::string key, std::string value)
{
   PSIBASE_SUBJECTIVE_TX
   {
      Tables{}.open<SubjectiveTable>().put({key, value});
   }
}

std::optional<std::string> SubjectiveService::read(std::string key)
{
   PSIBASE_SUBJECTIVE_TX
   {
      if (auto result = Tables{}.open<SubjectiveTable>().getIndex<0>().get(key))
         return result->value;
   }
   return {};
}

PSIBASE_DISPATCH(SubjectiveService)
