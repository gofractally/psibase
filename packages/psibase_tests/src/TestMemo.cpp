#include <services/test/TestMemo.hpp>

#include <psibase/dispatch.hpp>
#include <psio/from_json.hpp>

using namespace psibase;
using namespace TestService;
using namespace psio;

std::string TestMemo::testValue(Memo memo)
{
   return memo.contents;
}
std::string TestMemo::testView(view<const Memo> memo)
{
   return memo.contents();
}
void TestMemo::testJson(const std::string& data)
{
   psio::convert_from_json<Memo>(data);
}
void TestMemo::testConstruct(const std::string& data)
{
   Memo{data};
}

PSIBASE_DISPATCH(TestMemo)
