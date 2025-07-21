#include <psibase/Service.hpp>

namespace UserService
{
   struct Nop : psibase::Service
   {
      static constexpr auto service = psibase::AccountNumber{"nop"};
      void                  nop();
   };
   PSIO_REFLECT(Nop, method(nop))
}  // namespace UserService
