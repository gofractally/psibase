// This contract
#include "caller.hpp"

// Other contract
#include "arithmetic.hpp"

#include <psibase/dispatch.hpp>
#include <psibase/serveSimpleUI.hpp>

int32_t Caller::mult_add(int32_t a, int32_t b, int32_t c, int32_t d)
{
   // This allows us to call into the Arithmetic contract
   auto otherContract = at<Arithmetic>(Arithmetic::service);

   // Compute the result. Calls into the Arithmetic contract 3 times.
   return otherContract
       .add(                                       //
           otherContract.multiply(a, b).unpack(),  //
           otherContract.multiply(c, d).unpack())
       .unpack();
}

std::optional<psibase::HttpReply> Caller::serveSys(  //
    psibase::HttpRequest request)
{
   return serveSimpleUI<Caller, true>(request);
}

PSIBASE_DISPATCH(Caller)
