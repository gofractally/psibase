#include <services/test/TestMemo.hpp>

#include <psibase/dispatch.hpp>
#include <psio1/from_json.hpp>

using namespace psibase;
using namespace TestService;
using namespace psio1;

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
   psio1::convert_from_json<Memo>(data);
}
void TestMemo::testConstruct(const std::string& data)
{
   Memo{data};
}

PSIBASE_DISPATCH(TestMemo)
