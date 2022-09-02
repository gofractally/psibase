#include "arithmetic.hpp"

#include <psibase/dispatch.hpp>
#include <psibase/serveSimpleUI.hpp>

// The implementation file has the action definitions
int32_t Arithmetic::add(int32_t a, int32_t b)
{
   return a + b;
}

int32_t Arithmetic::multiply(int32_t a, int32_t b)
{
   return a * b;
}

std::optional<psibase::HttpReply> Arithmetic::serveSys(  //
    psibase::HttpRequest request)
{
   return serveSimpleUI<Arithmetic, true>(request);
}

// The implementation file has the dispatcher
PSIBASE_DISPATCH(Arithmetic)
