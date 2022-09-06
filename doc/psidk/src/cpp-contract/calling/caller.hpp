#include <psibase/psibase.hpp>

struct Caller : psibase::Service<Caller>
{
   static constexpr auto service = psibase::AccountNumber("caller");

   int32_t mult_add(int32_t a, int32_t b, int32_t c, int32_t d);

   std::optional<psibase::HttpReply> serveSys(psibase::HttpRequest request);
};

PSIO_REFLECT(  //
    Caller,
    method(mult_add, a, b, c, d),
    method(serveSys, request))
