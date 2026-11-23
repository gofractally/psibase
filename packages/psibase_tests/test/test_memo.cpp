#include <services/test/TestMemo.hpp>

#include <catch2/catch_all.hpp>
#include <psibase/DefaultTestChain.hpp>

using namespace psibase;
using namespace TestService;

TEST_CASE("memo")
{
   std::string shortData =
       "00000000001111111111222222222233333333334444444444555555555566666666667777777777";
   std::string longData =
       "000000000011111111112222222222333333333344444444445555555555666666666677777777778";

   std::string invalidData = "abcdef\xFF";

   DefaultTestChain t;
   auto             test_service = t.addService(TestMemo::service, "TestMemo.wasm");

   auto memoSvc = t.from(TestMemo::service).to<TestMemo>();
   CHECK(memoSvc.testValue(Memo{shortData}).returnVal() == shortData);
   CHECK(memoSvc.testView(Memo{shortData}).returnVal() == shortData);

   // A memo is a bounded string: an argument list that holds one has narrow
   // offsets, and no writer packs a memo of 81 bytes. The bytes of such a
   // call are the bytes of the longest valid call with one more byte of
   // text; the service refuses them before the action runs.
   auto tooLong = [&](std::string_view method)
   {
      auto args = psio::to_pssz(std::tuple{Memo{shortData}});
      args.push_back('8');
      return TraceResult{t.pushTransaction(t.makeTransaction(
          {Action{TestMemo::service, TestMemo::service, MethodNumber{method}, std::move(args)}}))};
   };
   CHECK(tooLong("testValue").failed("invalid argument encoding for testvalue"));
   CHECK(tooLong("testView").failed("invalid argument encoding for testview"));

   // The same text as a plain string is another encoding (wide offsets).
   {
      auto asString = psio::to_pssz(std::tuple{shortData});
      CHECK(asString != psio::to_pssz(std::tuple{Memo{shortData}}));
      CHECK(TraceResult{t.pushTransaction(t.makeTransaction({Action{
                TestMemo::service, TestMemo::service, MethodNumber{"testValue"}, asString}}))}
                .failed("invalid argument encoding for testvalue"));
   }

   CHECK(psio::from_ijson<Memo>(psio::to_ijson(shortData)).contents == shortData);
   CHECK(psio::to_ijson(Memo{shortData}) == psio::to_ijson(shortData));
   CHECK(t.from(TestMemo::service)
             .to<TestMemo>()
             .testJson(psio::to_ijson(longData))
             .failed("json: member length_bound violated"));

   CHECK(t.from(TestMemo::service)
             .to<TestMemo>()
             .testConstruct(longData)
             .failed("Memo exceeds 80 bytes"));

   CHECK(t.from(TestMemo::service)
             .to<TestMemo>()
             .testConstruct(invalidData)
             .failed("Memo must be valid UTF-8"));
}
