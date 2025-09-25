#pragma once

#include <cstdint>
#include <psibase/Service.hpp>
#include <psibase/nativeTables.hpp>

namespace TestService
{
   struct TestExport : psibase::Service
   {
      static constexpr auto service = psibase::AccountNumber{"test-export"};
      static constexpr auto flags   = psibase::CodeRow::isPrivileged;

      void testPlain();
      void testRpc();
      void testCallback();
      void doExport(int initialValue, bool subjective);
      int  getValue();
   };
   PSIO_REFLECT(TestExport,
                method(testPlain),
                method(testRpc),
                method(testCallback),
                method(doExport, initialValue),
                method(getValue))
}  // namespace TestService
