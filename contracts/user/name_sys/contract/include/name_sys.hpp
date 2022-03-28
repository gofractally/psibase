#pragma once

#include <compare>
#include <psibase/actor.hpp>
#include <psibase/table.hpp>
#include <string_view>

namespace name_sys
{
   struct display_name_row
   {
      psibase::account_num acc;
      std::string          display_name;

      friend std::strong_ordering operator<=>(const display_name_row&,
                                              const display_name_row&) = default;
   };
   EOSIO_REFLECT(display_name_row, acc, display_name);
   PSIO_REFLECT(display_name_row, acc, display_name);

   using display_name_table_t = psibase::table<display_name_row, &display_name_row::acc>;

   using tables = psibase::contract_tables<display_name_table_t>;
   class name_contract : public psibase::contract
   {
     public:
      static constexpr psibase::account_num contract     = 102;
      static constexpr std::string_view     account_name = "name_sys";

      // Mutate
      void create(psibase::account_num account, psibase::account_num ram_payer);

      // Read-only interface

     private:
      tables db{contract};
   };

   // clang-format off
   PSIO_REFLECT_INTERFACE(name_contract, 
      (create, 0, account, ram_payer)
   );
   // clang-format on

}  // namespace name_sys