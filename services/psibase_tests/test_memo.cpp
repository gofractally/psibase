#define MEMO_IS_STRING

#include <services/test/TestMemo.hpp>

#include <catch2/catch_all.hpp>
#include <psibase/DefaultTestChain.hpp>

using namespace psibase;
using namespace TestService;
using namespace psio;

TEST_CASE("memo")
{
   std::string shortData =
       "00000000001111111111222222222233333333334444444444555555555566666666667777777777";
   std::string longData =
       "000000000011111111112222222222333333333344444444445555555555666666666677777777778";

   std::string invalidData = "abcdef\xFF";

   DefaultTestChain t;
   auto             test_service = t.addService(TestMemo::service, "TestMemo.wasm");

   CHECK(t.from(TestMemo::service).to<TestMemo>().testValue(shortData).returnVal() == shortData);
   CHECK(t.from(TestMemo::service)
             .to<TestMemo>()
             .testValue(longData)
             .failed("Memo exceeds 80 bytes"));

   CHECK(t.from(TestMemo::service).to<TestMemo>().testView(shortData).returnVal() == shortData);
   CHECK(
       t.from(TestMemo::service).to<TestMemo>().testView(longData).failed("Memo exceeds 80 bytes"));

   CHECK(convert_from_json<Memo>(convert_to_json(shortData)).contents == shortData);
   CHECK(convert_to_json(Memo{shortData}) == convert_to_json(shortData));
   CHECK(t.from(TestMemo::service)
             .to<TestMemo>()
             .testJson(psio::convert_to_json(longData))
             .failed("Memo exceeds 80 bytes"));

   CHECK(t.from(TestMemo::service)
             .to<TestMemo>()
             .testConstruct(longData)
             .failed("Memo exceeds 80 bytes"));

   CHECK(t.from(TestMemo::service)
             .to<TestMemo>()
             .testConstruct(invalidData)
             .failed("Memo must be valid UTF-8"));
}
