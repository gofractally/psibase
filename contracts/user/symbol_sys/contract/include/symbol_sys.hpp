#pragma once

#include <compare>
#include <psibase/actor.hpp>
#include <psibase/table.hpp>
#include <string_view>

#include "nft_sys.hpp"

namespace symbol_sys
{
   struct symbol_row
   {
      UserContract::NID nft_id;
      std::string       symbol_name;

      friend std::strong_ordering operator<=>(const symbol_row&, const symbol_row&) = default;
   };
   EOSIO_REFLECT(symbol_row, symbol_name, nft_id);
   PSIO_REFLECT(symbol_row, symbol_name, nft_id);

   using symbol_table_t = psibase::table<symbol_row, &symbol_row::nft_id>;

   using tables = psibase::contract_tables<symbol_table_t>;
   class symbol_contract : public psibase::contract
   {
     public:
      static constexpr psibase::AccountNumber contract = "symbol-sys"_a;

      // Mutate
      void create(psibase::AccountNumber owner, int64_t max_supply);
      void purchase(psibase::AccountNumber buyer, std::string newsymbol, int64_t amount);
      void buysymbol(psibase::AccountNumber buyer, std::string symbol);
      void sellsymbol(std::string symbol, int64_t price);
      void withdraw(psibase::AccountNumber owner, int64_t amount);
      void setsalefee(uint32_t fee);
      void setsym(uint32_t symlen,
                  int64_t  price,
                  int64_t  floor,
                  uint32_t increase_thresold,
                  uint32_t decrease_threshold,
                  uint32_t window);
      void setowner(psibase::AccountNumber owner, std::string sym, std::string memo);

     private:
      tables db{contract};
   };

   // clang-format off
   PSIO_REFLECT_INTERFACE(symbol_contract, 
      (create, 0, owner, max_supply)
   );
   // clang-format on

}  // namespace symbol_sys