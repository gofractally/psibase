#include <psibase/Contract.hpp>
#include <psibase/SimpleUI.hpp>
#include <psibase/dispatch.hpp>

struct ExampleContract : psibase::Contract<ExampleContract>, psibase::SimpleUI<ExampleContract>
{
   int32_t add(int32_t a, int32_t b) { return a + b; }
   int32_t multiply(int32_t a, int32_t b) { return a * b; }
};

PSIO_REFLECT(ExampleContract,
             method(add, a, b),
             method(multiply, a, b),

             // This method, provided by SimpleUI, serves UI files
             // to the browser and provides an RPC interface for
             // preparing transactions.
             method(serveSys, request))

PSIBASE_DISPATCH(ExampleContract)
