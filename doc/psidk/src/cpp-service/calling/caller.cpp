// This service
#include "caller.hpp"

// Other service
#include "arithmetic.hpp"

int32_t Caller::mult_add(int32_t a, int32_t b, int32_t c, int32_t d)
{
   // This allows us to call into the Arithmetic service
   auto otherService = to<Arithmetic>(Arithmetic::service);

   // Compute the result. Calls into the Arithmetic service 3 times.
   return otherService
       .add(                                      //
           otherService.multiply(a, b).unpack(),  //
           otherService.multiply(c, d).unpack())
       .unpack();
}

std::optional<psibase::HttpReply> Caller::serveSys(  //
    psibase::HttpRequest request)
{
   return serveSimpleUI<Caller, true>(request);
}

PSIBASE_DISPATCH(Caller)
