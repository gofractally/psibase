#pragma once
#include <psibase/actor.hpp>

namespace company {

   class min_contract : public psibase::contract {
      public:
         void hello() { psibase::write_console("hello world"); }
   };

   PSIO_REFLECT_INTERFACE( min_contract, (hello, 0) )
}
