#include "event-service.hpp"

#include <psibase/dispatch.hpp>

using namespace psibase;

psibase::EventNumber EventService::foo(std::string s, int i)
{
   return emit().history().e(s, i);
}

psibase::EventNumber EventService::emitMerkle(std::string s)
{
   return emit().merkle().m(s);
}

psibase::EventNumber EventService::emitFail(std::string s, int i)
{
   emit().history().e(s, i);
   abortMessage("die");
}

PSIBASE_DISPATCH(EventService)
