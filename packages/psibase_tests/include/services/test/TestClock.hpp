#pragma once

#include <psibase/Service.hpp>
#include <psibase/nativeTables.hpp>

struct TestClock : psibase::Service
{
   static constexpr auto     service      = psibase::AccountNumber{"clock-service"};
   static constexpr uint64_t serviceFlags = 0;

   void testReal(bool indirect);
   void testMono(bool indirect);
   void testCpu(bool indirect);
   void testSystem(bool indirect);
   //void testUtc();
   void testSteady(bool indirect);
   void testHiRes(bool indirect);
};

PSIO_REFLECT(TestClock,
             method(testReal, indirect),
             method(testMono, indirect),
             method(testCpu, indirect),
             method(testSystem, indirect),
             method(testSteady, indirect),
             method(testHiRes, indirect))
