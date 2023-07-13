#include "clock-service.hpp"

#include <psibase/DefaultTestChain.hpp>
#include <psibase/serveGraphQL.hpp>

#include <catch2/catch.hpp>

using namespace psibase;

TEST_CASE("test clock")
{
   DefaultTestChain t;
   t.addService<ClockService>("clock-service.wasm");

   auto clockService = t.from(ClockService::service).to<ClockService>();

   CHECK(clockService.testReal().succeeded());
   CHECK(clockService.testMono().succeeded());
   CHECK(clockService.testCpu().succeeded());

   CHECK(clockService.testSystem().succeeded());
   //CHECK(clockService.testUtc().succeeded());
   CHECK(clockService.testSteady().succeeded());
   CHECK(clockService.testHiRes().succeeded());
}
