#include <services/test/AbortService.hpp>

#include <psibase/dispatch.hpp>

using namespace psibase;
using namespace TestService;

void AbortService::abort(std::string message)
{
   abortMessage(message);
}

PSIBASE_DISPATCH(AbortService)
