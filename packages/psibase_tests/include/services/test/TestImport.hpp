#pragma once

#include <cstdint>
#include <psibase/Service.hpp>

namespace TestService
{
   struct TestImport : psibase::Service
   {
      static constexpr auto service = psibase::AccountNumber{"test-import"};
      static constexpr auto flags   = std::uint64_t(0);

      void testPlain();
      void testRpc();
      void testCallback();
      void testImport(bool expectHandle);
   };
   PSIO_REFLECT(TestImport,
                method(testPlain),
                method(testRpc),
                method(testCallback),
                method(testImport, expectHandle))
}  // namespace TestService
