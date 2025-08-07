#pragma once

#include <psibase/Service.hpp>

namespace TestService
{
   struct TestKV : psibase::Service
   {
      static constexpr auto service = psibase::AccountNumber{"test-kv"};
      void                  test();
   };
   PSIO_REFLECT(TestKV, method(test))
}  // namespace TestService
