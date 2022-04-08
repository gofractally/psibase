#pragma once
#include <psibase/actor.hpp>
#include <psibase/name.hpp>

namespace company
{
   class min_contract : public psibase::contract
   {
     public:
      static constexpr psibase::account_id_type id = psibase::name_to_number("mincon");  //_a;
      void                                      hello() { psibase::write_console("hello world"); }
   };

   PSIO_REFLECT(min_contract, method(hello))
}  // namespace company
