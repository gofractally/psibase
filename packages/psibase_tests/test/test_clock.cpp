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

   CHECK(clockService.testReal(true).succeeded());
   CHECK(clockService.testMono(true).succeeded());
   CHECK(clockService.testCpu(true).succeeded());

   CHECK(clockService.testSystem(true).succeeded());
   //CHECK(clockService.testUtc().succeeded());
   CHECK(clockService.testSteady(true).succeeded());
   CHECK(clockService.testHiRes(true).succeeded());
}
