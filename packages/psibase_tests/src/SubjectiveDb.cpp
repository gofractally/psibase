#include <services/test/SubjectiveDb.hpp>

#include <psibase/dispatch.hpp>
#include <services/system/Transact.hpp>

using namespace psibase;
using namespace TestService;
using namespace SystemService;

namespace
{
   bool isRpc()
   {
      return !to<Transact>().isTransaction();
   }
}  // namespace

void SubjectiveDb::write(std::string key, std::string value)
{
   if (!isRpc())
      return recurse().withFlags(CallFlags::runModeRpc).write(key, value);
   PSIBASE_SUBJECTIVE_TX
   {
      Tables{}.open<SubjectiveTable>().put({key, value});
   }
}

std::optional<std::string> SubjectiveDb::read(std::string key)
{
   if (!isRpc())
      return recurse().withFlags(CallFlags::runModeRpc).read(key);
   PSIBASE_SUBJECTIVE_TX
   {
      if (auto result = Tables{}.open<SubjectiveTable>().getIndex<0>().get(key))
         return result->value;
   }
   return {};
}

void SubjectiveDb::testRFail1(std::string key, bool txBefore, int op)
{
   if (!isRpc())
      return recurse().withFlags(CallFlags::runModeRpc).testRFail1(key, txBefore, op);
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

void SubjectiveDb::testRFail2(AccountNumber account, std::string key, int op)
{
   if (!isRpc())
      return recurse().withFlags(CallFlags::runModeRpc).testRFail2(account, key, op);
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

void SubjectiveDb::testWFail1(std::string key, std::string value)
{
   if (!isRpc())
   {
      return recurse().withFlags(CallFlags::runModeRpc).testWFail1(key, value);
   }
   Tables{}.open<SubjectiveTable>().put({key, value});
}

void SubjectiveDb::abort(std::string key, std::string value, int op)
{
   if (!isRpc())
      return recurse().withFlags(CallFlags::runModeRpc).abort(key, value, op);
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

void SubjectiveDb::nested(std::string key, std::string value1, std::string value2)
{
   if (!isRpc())
      return recurse().withFlags(CallFlags::runModeRpc).nested(key, value1, value2);
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

void SubjectiveDb::nestFail1a(bool commit)
{
   if (!isRpc())
      return recurse().withFlags(CallFlags::runModeRpc).nestFail1a(commit);
   psibase::checkoutSubjective();
   recurse().to<SubjectiveDb>().nestFail1b(commit);
}

void SubjectiveDb::nestFail1b(bool commit)
{
   if (!isRpc())
      return recurse().withFlags(CallFlags::runModeRpc).nestFail1b(commit);
   if (commit)
      psibase::commitSubjective();
   else
      psibase::abortSubjective();
}

void SubjectiveDb::nestFail2a(bool commit)
{
   if (!isRpc())
      return recurse().withFlags(CallFlags::runModeRpc).nestFail2a(commit);
   recurse().to<SubjectiveDb>().nestFail2b();
   if (commit)
      psibase::commitSubjective();
   else
      psibase::abortSubjective();
}

void SubjectiveDb::nestFail2b()
{
   if (!isRpc())
      return recurse().withFlags(CallFlags::runModeRpc).nestFail2b();
   psibase::checkoutSubjective();
}

void SubjectiveDb::nestFail3a(bool commit1, bool commit2)
{
   if (!isRpc())
      return recurse().withFlags(CallFlags::runModeRpc).nestFail3a(commit1, commit2);
   psibase::checkoutSubjective();
   recurse().to<SubjectiveDb>().nestFail3b(commit2);
   if (commit1)
      psibase::commitSubjective();
   else
      psibase::abortSubjective();
}

void SubjectiveDb::nestFail3b(bool commit)
{
   if (!isRpc())
      return recurse().withFlags(CallFlags::runModeRpc).nestFail3b(commit);
   if (commit)
      psibase::commitSubjective();
   else
      psibase::abortSubjective();
   psibase::checkoutSubjective();
}

std::optional<HttpReply> SubjectiveDb::serveSys(const HttpRequest& req)
{
   if (req.target == "/write")
   {
      auto row =
          psio::convert_from_json<SubjectiveRow>(std::string(req.body.data(), req.body.size()));
      PSIBASE_SUBJECTIVE_TX
      {
         Tables{}.open<SubjectiveTable>().put(row);
      }
      return HttpReply{.headers = allowCors()};
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
      HttpReply           response{.contentType = "application/json", .headers = allowCors()};
      psio::vector_stream stream{response.body};
      psio::to_json(result, stream);
      return response;
   }
   return {};
}

PSIBASE_DISPATCH(SubjectiveDb)
