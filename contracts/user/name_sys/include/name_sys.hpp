#pragma once

#include <compare>
#include <psibase/Contract.hpp>
#include <psibase/Table.hpp>
#include <string_view>

namespace name_sys
{
   struct display_name_row
   {
      psibase::AccountNumber acc;
      std::string            display_name;

      friend std::strong_ordering operator<=>(const display_name_row&,
                                              const display_name_row&) = default;
   };
   PSIO_REFLECT(display_name_row, acc, display_name);

   using display_name_table_t = psibase::Table<display_name_row, &display_name_row::acc>;

   using tables = psibase::ContractTables<display_name_table_t>;
   class name_contract : public psibase::Contract<name_contract>
   {
     public:
      static constexpr auto contract = psibase::AccountNumber("name-sys");

      // Mutate
      void create(psibase::AccountNumber account, psibase::AccountNumber ram_payer);

      // Read-only interface

     private:
      tables db{contract};
   };

   // clang-format off
   PSIO_REFLECT(name_contract, 
      method(create, account, ram_payer)
   );
   // clang-format on

}  // namespace name_sys
