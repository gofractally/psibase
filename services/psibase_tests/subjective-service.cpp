#include "subjective-service.hpp"

#include <psibase/dispatch.hpp>

using namespace psibase;

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

void SubjectiveService::testRFail1(std::string key, bool txBefore, int op)
{
   if (txBefore)
   {
      PSIBASE_SUBJECTIVE_TX {}
   }
   auto index = Tables{}.open<SubjectiveTable>().getIndex<0>();
   if (op == 0)
      index.get(key);
   else if (op == 1)
      index.lower_bound(key);
   else if (op == 2)
      index.upper_bound(key);
   else if (op == 3)
      --index.end();
}

void SubjectiveService::testRFail2(AccountNumber account, std::string key, int op)
{
   auto index = Tables{account}.open<SubjectiveTable>().getIndex<0>();
   PSIBASE_SUBJECTIVE_TX
   {
      if (op == 0)
         index.get(key);
      else if (op == 1)
         index.lower_bound(key);
      else if (op == 2)
         index.upper_bound(key);
      else if (op == 3)
         --index.end();
   }
}

void SubjectiveService::testWFail1(std::string key, std::string value)
{
   Tables{}.open<SubjectiveTable>().put({key, value});
}

std::optional<HttpReply> SubjectiveService::serveSys(const HttpRequest& req)
{
   if (req.target == "/write")
   {
      auto row =
          psio::convert_from_json<SubjectiveRow>(std::string(req.body.data(), req.body.size()));
      PSIBASE_SUBJECTIVE_TX
      {
         Tables{}.open<SubjectiveTable>().put(row);
      }
      return HttpReply{};
   }
   else if (req.target == "/read")
   {
      auto key =
          psio::convert_from_json<std::string>(std::string(req.body.data(), req.body.size()));
      std::optional<std::string> result;
      PSIBASE_SUBJECTIVE_TX
      {
         if (auto row = Tables{}.open<SubjectiveTable>().getIndex<0>().get(key))
            result = row->value;
      }
      HttpReply           response{.contentType = "application/json"};
      psio::vector_stream stream{response.body};
      psio::to_json(result, stream);
      return response;
   }
   return {};
}

PSIBASE_DISPATCH(SubjectiveService)
