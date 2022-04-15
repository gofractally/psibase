#include <psibase/contract.hpp>
#include <psibase/dispatch.hpp>
#include <psibase/simple_ui.hpp>

// The contract
struct example_contract : psibase::contract, psibase::simple_ui<example_contract>
{
   // Add two numbers
   int32_t add(int32_t a, int32_t b) { return a + b; }

   // Multiply two numbers
   int32_t multiply(int32_t a, int32_t b) { return a * b; }
};

// Enable reflection. This enables PSIBASE_DISPATCH and other
// mechanisms to operate.
PSIO_REFLECT(example_contract,  //
             method(add, a, b),
             method(multiply, a, b),

             // This method, provided by simple_ui, serves UI files
             // to the browser and provides an RPC interface for
             // preparing transactions.
             method(serveSys, request))

// Allow users to invoke reflected methods inside transactions.
// Also allows other contracts to invoke these methods.
PSIBASE_DISPATCH(example_contract)
