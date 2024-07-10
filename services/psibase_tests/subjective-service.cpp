#include "subjective-service.hpp"

#include <psibase/dispatch.hpp>

using namespace psibase;

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

void SubjectiveService::abort(std::string key, std::string value, int op)
{
   PSIBASE_SUBJECTIVE_TX
   {
      Tables{}.open<SubjectiveTable>().put({key, value});
      if (op == 0)
         return;
      else if (op == 1)
         break;
      else if (op == 2)
         abortMessage("fail");
   }
}

void SubjectiveService::nested(std::string key, std::string value1, std::string value2)
{
   auto table = Tables{}.open<SubjectiveTable>();
   PSIBASE_SUBJECTIVE_TX
   {
      table.put({key, value1});
      PSIBASE_SUBJECTIVE_TX
      {
         table.put({key, value2});
         break;
      }
   }
}

void SubjectiveService::nestFail1a(bool commit)
{
   psibase::checkoutSubjective();
   to<SubjectiveService>().nestFail1b(commit);
}

void SubjectiveService::nestFail1b(bool commit)
{
   if (commit)
      psibase::commitSubjective();
   else
      psibase::abortSubjective();
}

void SubjectiveService::nestFail2a(bool commit)
{
   to<SubjectiveService>().nestFail2b();
   if (commit)
      psibase::commitSubjective();
   else
      psibase::abortSubjective();
}

void SubjectiveService::nestFail2b()
{
   psibase::checkoutSubjective();
}

void SubjectiveService::nestFail3a(bool commit1, bool commit2)
{
   psibase::checkoutSubjective();
   to<SubjectiveService>().nestFail3b(commit2);
   if (commit1)
      psibase::commitSubjective();
   else
      psibase::abortSubjective();
}

void SubjectiveService::nestFail3b(bool commit)
{
   if (commit)
      psibase::commitSubjective();
   else
      psibase::abortSubjective();
   psibase::checkoutSubjective();
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
