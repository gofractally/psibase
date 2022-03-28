#pragma once

#include <compare>
#include <psibase/actor.hpp>
#include <psibase/table.hpp>
#include <string_view>

namespace exchange_sys
{
   class exchange_contract : public psibase::contract
   {
     public:
      static constexpr psibase::account_num contract     = 104;
      static constexpr std::string_view     account_name = "exchange_sys";

      // This action allows the storage_payer account to create an account owner with zero token balance at the expense of ram_payer for specified token ID
      void stub();
   };

   // clang-format off
   PSIO_REFLECT_INTERFACE(exchange_contract, 
      (stub, 0)
   );
   // clang-format on

}  // namespace exchange_sys