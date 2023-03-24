#include "event-service.hpp"

#include <psibase/dispatch.hpp>

using namespace psibase;

psibase::EventNumber EventService::foo(std::string s, int i)
{
   return emit().history().e(s, i);
}

PSIBASE_DISPATCH(EventService)
