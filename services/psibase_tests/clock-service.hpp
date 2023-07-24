#pragma once

#include <psibase/Service.hpp>
#include <psibase/nativeTables.hpp>

struct ClockService : psibase::Service<ClockService>
{
   static constexpr auto     service      = psibase::AccountNumber{"clock-service"};
   static constexpr uint64_t serviceFlags = psibase::CodeRow::isSubjective;
   void                      testReal();
   void                      testMono();
   void                      testCpu();
   void                      testSystem();
   //void testUtc();
   void testSteady();
   void testHiRes();
};

PSIO_REFLECT(ClockService,
             method(testReal),
             method(testMono),
             ,
             method(testCpu),
             method(testSystem),
             method(testSteady),
             method(testHiRes))
