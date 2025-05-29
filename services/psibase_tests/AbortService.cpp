#include "AbortService.hpp"

#include <psibase/dispatch.hpp>

using namespace psibase;

void AbortService::abort(std::string message)
{
   abortMessage(message);
}

PSIBASE_DISPATCH(AbortService)
