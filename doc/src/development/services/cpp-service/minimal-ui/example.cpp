#include <psibase/psibase.hpp>

struct ExampleService
{
   int32_t add(int32_t a, int32_t b) { return a + b; }
   int32_t multiply(int32_t a, int32_t b) { return a * b; }

   // This action serves HTTP requests
   std::optional<psibase::HttpReply> serveSys(psibase::HttpRequest request)
   {
      // serveSimpleUI serves UI files to the browser and
      // provides an RPC interface for preparing transactions.
      return serveSimpleUI<ExampleService, true>(request);
   }
};

PSIO_REFLECT(ExampleService,  //
             method(add, a, b),
             method(multiply, a, b),
             method(serveSys, request))

PSIBASE_DISPATCH(ExampleService)
