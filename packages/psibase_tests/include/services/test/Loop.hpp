#pragma once

#include <psibase/Service.hpp>

namespace TestService
{
   struct Loop : psibase::Service
   {
      static constexpr auto service = psibase::AccountNumber{"loop"};
      void                  loop();
   };
   PSIO_REFLECT(Loop, method(loop))
}  // namespace TestService
