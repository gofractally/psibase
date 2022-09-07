#include <psibase/psibase.hpp>

// The header includes the class definition
struct Arithmetic : psibase::Service<Arithmetic>
{
   // The account this service is normally installed on
   static constexpr auto service = psibase::AccountNumber("arithmetic");

   // The header declares but doesn't implement the actions
   int32_t add(int32_t a, int32_t b);
   int32_t multiply(int32_t a, int32_t b);

   std::optional<psibase::HttpReply> serveSys(psibase::HttpRequest request);
};

// The header does the reflection
PSIO_REFLECT(  //
    Arithmetic,
    method(add, a, b),
    method(multiply, a, b),
    method(serveSys, request))

// Do NOT include PSIBASE_DISPATCH in the header
