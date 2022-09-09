#pragma once
#include <psibase/Service.hpp>
#include <psibase/name.hpp>
#include <psibase/nativeFunctions.hpp>

namespace company
{
   class MinService : public psibase::Service<MinService>
   {
     public:
      static constexpr psibase::account_id_type id = psibase::name_to_number("mincon");  //_a;
      void                                      hello() { psibase::writeConsole("hello world"); }
   };

   PSIO_REFLECT(MinService, method(hello))
}  // namespace company
