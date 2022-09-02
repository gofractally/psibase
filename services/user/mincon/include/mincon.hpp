#pragma once
#include <psibase/Contract.hpp>
#include <psibase/name.hpp>
#include <psibase/nativeFunctions.hpp>

namespace company
{
   class min_contract : public psibase::Contract<min_contract>
   {
     public:
      static constexpr psibase::account_id_type id = psibase::name_to_number("mincon");  //_a;
      void                                      hello() { psibase::writeConsole("hello world"); }
   };

   PSIO_REFLECT(min_contract, method(hello))
}  // namespace company
