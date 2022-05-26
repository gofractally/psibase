#include <psibase/Contract.hpp>
#include <psibase/dispatch.hpp>
#include <psibase/serveSimpleUI.hpp>

struct ExampleContract : psibase::Contract<ExampleContract>
{
   int32_t add(int32_t a, int32_t b) { return a + b; }
   int32_t multiply(int32_t a, int32_t b) { return a * b; }

   // This action serves HTTP requests
   std::optional<psibase::RpcReplyData> serveSys(psibase::RpcRequestData request)
   {
      // serveSimpleUI serves UI files to the browser and
      // provides an RPC interface for preparing transactions.
      return serveSimpleUI<ExampleContract, true>(request);
   }
};

PSIO_REFLECT(ExampleContract,  //
             method(add, a, b),
             method(multiply, a, b),
             method(serveSys, request))

PSIBASE_DISPATCH(ExampleContract)
