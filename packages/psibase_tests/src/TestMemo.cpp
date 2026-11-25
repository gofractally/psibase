#include <services/test/TestMemo.hpp>

#include <psibase/dispatch.hpp>
#include <psio/json.hpp>

using namespace psibase;
using namespace TestService;

std::string TestMemo::testValue(Memo memo)
{
   return memo.contents;
}
std::string TestMemo::testView(psio::pssz_view<Memo> memo)
{
   return memo.unpack().contents;
}
void TestMemo::testJson(const std::string& memo)
{
   (void)psio::from_ijson<Memo>(memo);
}
void TestMemo::testConstruct(const std::string& memo)
{
   Memo{memo};
}

PSIBASE_DISPATCH(TestMemo)
