#pragma once

#include <psibase/Service.hpp>
#include <psibase/nativeTables.hpp>

struct TestClock : psibase::Service
{
   static constexpr auto     service      = psibase::AccountNumber{"clock-service"};
   static constexpr uint64_t serviceFlags = psibase::CodeRow::isSubjective;

   void testReal();
   void testMono();
   void testCpu();
   void testSystem();
   //void testUtc();
   void testSteady();
   void testHiRes();
};

PSIO_REFLECT(TestClock,
             method(testReal),
             method(testMono),
             method(testCpu),
             method(testSystem),
             method(testSteady),
             method(testHiRes))
