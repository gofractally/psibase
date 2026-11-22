#include <psibase/Service.hpp>

namespace UserService
{
   struct Nop : psibase::Service
   {
      static constexpr auto service = psibase::AccountNumber{"nop"};

      void nop();
      void withId(std::uint32_t id);
   };
   PSIO_REFLECT(Nop, method(nop), method(withId, id))
}  // namespace UserService
