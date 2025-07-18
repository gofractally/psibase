#include <services/test/TestClock.hpp>

#include <psibase/DefaultTestChain.hpp>
#include <psibase/serveGraphQL.hpp>

#include <catch2/catch_all.hpp>

using namespace psibase;

TEST_CASE("test clock")
{
   DefaultTestChain t;
   t.addService<TestClock>("TestClock.wasm");

   auto clockService = t.from(TestClock::service).to<TestClock>();

   CHECK(clockService.testReal().succeeded());
   CHECK(clockService.testMono().succeeded());
   CHECK(clockService.testCpu().succeeded());

   CHECK(clockService.testSystem().succeeded());
   //CHECK(clockService.testUtc().succeeded());
   CHECK(clockService.testSteady().succeeded());
   CHECK(clockService.testHiRes().succeeded());
}
