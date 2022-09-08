#include <psibase/psibase.hpp>

// The service
struct ExampleService
{
   // Add two numbers
   int32_t add(int32_t a, int32_t b) { return a + b; }

   // Multiply two numbers
   int32_t multiply(int32_t a, int32_t b) { return a * b; }
};

// Enable reflection. This enables PSIBASE_DISPATCH and other
// mechanisms to operate.
PSIO_REFLECT(ExampleService,  //
             method(add, a, b),
             method(multiply, a, b))

// Allow users to invoke reflected methods inside transactions.
// Also allows other services to invoke these methods.
PSIBASE_DISPATCH(ExampleService)
