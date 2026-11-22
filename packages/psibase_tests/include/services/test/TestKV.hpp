#pragma once

#include <psibase/Service.hpp>
#include <psibase/nativeTables.hpp>

namespace TestService
{
   struct TestKV : psibase::Service
   {
      static constexpr auto service = psibase::AccountNumber{"test-kv"};
      static constexpr auto flags   = psibase::CodeRow::isPrivileged;
      void                  test();
   };
   PSIO_REFLECT(TestKV, method(test))
}  // namespace TestService
