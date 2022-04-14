#pragma once

#include <compare>
#include <psibase/contract.hpp>
#include <psibase/table.hpp>
#include <string_view>

namespace exchange_sys
{
   class exchange_contract : public psibase::contract
   {
     public:
      static constexpr psibase::AccountNumber contract = "exchange-sys"_a;

      // This action allows the storage_payer account to create an account owner with zero token balance at the expense of ram_payer for specified token ID
      void stub();
   };

   // clang-format off
   PSIO_REFLECT(exchange_contract, 
      method(stub)
   );
   // clang-format on

}  // namespace exchange_sys