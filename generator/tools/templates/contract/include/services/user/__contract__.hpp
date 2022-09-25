#pragma once

#include <compare>
#include <psibase/Service.hpp>
#include <string_view>

namespace __contract__
{
   class __contract__Service : public psibase::Service<__contract__Service>
   {
     public:
      static constexpr auto service = psibase::AccountNumber("__contract__(kebabCase)");

      // This action allows the storage_payer account to create an account owner with zero token balance at the expense of ram_payer for specified token ID
      void stub();
   };

   // clang-format off
   PSIO_REFLECT(__contract__Service, 
      method(stub)
   );
   // clang-format on

}  // namespace __contract__
