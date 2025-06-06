#include <psibase/Memo.hpp>

#include <catch2/catch_all.hpp>
#include <psibase/DefaultTestChain.hpp>

using namespace psibase;
using namespace psio;

// This is a copy of the service in memo-service.cpp, except that it
// uses string instead of MemoService
// 1) using string verifies serialization compatibility between string and Memo
// 2) using string skips validation when building the transaction, so we can
//    get errors from the service.
struct MemoService
{
   static constexpr auto service = "memo-service"_a;
   std::string           testValue(std::string);
   std::string           testView(view<const std::string>);
   void                  testJson(const std::string& data);
   void                  testConstruct(const std::string& data);
};
PSIO_REFLECT(MemoService,
             method(testValue, memo),
             method(testView, memo),
             method(testJson, data),
             method(testConstruct, data))

TEST_CASE("memo")
{
   std::string shortData =
       "00000000001111111111222222222233333333334444444444555555555566666666667777777777";
   std::string longData =
       "000000000011111111112222222222333333333344444444445555555555666666666677777777778";

   std::string invalidData = "abcdef\xFF";

   DefaultTestChain t;
   auto             test_service = t.addService("memo-service"_a, "memo-service.wasm");

   CHECK(t.from("memo-service"_a).to<MemoService>().testValue(shortData).returnVal() == shortData);
   CHECK(t.from("memo-service"_a)
             .to<MemoService>()
             .testValue(longData)
             .failed("Memo exceeds 80 bytes"));

   CHECK(t.from("memo-service"_a).to<MemoService>().testView(shortData).returnVal() == shortData);
   CHECK(t.from("memo-service"_a)
             .to<MemoService>()
             .testView(longData)
             .failed("Memo exceeds 80 bytes"));

   CHECK(convert_from_json<Memo>(convert_to_json(shortData)).contents == shortData);
   CHECK(convert_to_json(Memo{shortData}) == convert_to_json(shortData));
   CHECK(t.from("memo-service"_a)
             .to<MemoService>()
             .testJson(psio::convert_to_json(longData))
             .failed("Memo exceeds 80 bytes"));

   CHECK(t.from("memo-service"_a)
             .to<MemoService>()
             .testConstruct(longData)
             .failed("Memo exceeds 80 bytes"));

   CHECK(t.from("memo-service"_a)
             .to<MemoService>()
             .testConstruct(invalidData)
             .failed("Memo must be valid UTF-8"));
}
