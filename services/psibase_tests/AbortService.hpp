#pragma once

#include <psibase/AccountNumber.hpp>
#include <psibase/Service.hpp>
#include <string>

struct AbortService : psibase::Service
{
   static constexpr auto service = psibase::AccountNumber{"abort"};
   void                  abort(std::string message);
};

PSIO_REFLECT(AbortService, method(abort, message))
