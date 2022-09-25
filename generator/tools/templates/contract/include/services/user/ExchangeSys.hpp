#pragma once

#include <compare>
#include <psibase/Service.hpp>
#include <string_view>

namespace ExchangeSys
{
   class ExchangeService : public psibase::Service<ExchangeService>
   {
     public:
      static constexpr auto service = psibase::AccountNumber("exchange-sys");

      // This action allows the storage_payer account to create an account owner with zero token balance at the expense of ram_payer for specified token ID
      void stub();
   };

   // clang-format off
   PSIO_REFLECT(ExchangeService, 
      method(stub)
   );
   // clang-format on

}  // namespace ExchangeSys
