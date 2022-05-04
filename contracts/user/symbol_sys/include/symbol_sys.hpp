#pragma once

#include <compare>
#include <psibase/Contract.hpp>
#include <psibase/table.hpp>
#include <string_view>

#include "nft_sys.hpp"

/* 04/18/2022
 * James and Dan call notes:
 * Symbols are still handled by symbol table, 32 bit symbols, only uppercase, no numbers
 * Symbols are mapped to NIDs, which can be burned in the NFT contract, but the symbol table will always hold on to Symbol->NID mapping
 * Symbol IDs can be specified in a separate action on the token contract to permanently map the symbol to the token (burns underlying NFT)
 * 
*/

namespace symbol_sys
{
   struct symbol_row
   {
      UserContract::NID nft_id;
      std::string       symbol_name;

      friend std::strong_ordering operator<=>(const symbol_row&, const symbol_row&) = default;
   };
   PSIO_REFLECT(symbol_row, symbol_name, nft_id);

   using symbol_table_t = psibase::table<symbol_row, &symbol_row::nft_id>;

   using tables = psibase::contract_tables<symbol_table_t>;
   class symbol_contract : public psibase::Contract<symbol_contract>
   {
     public:
      static constexpr auto contract = psibase::AccountNumber("symbol-sys");

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

   PSIO_REFLECT(  //
       symbol_contract,
       method(create, owner, max_supply));

}  // namespace symbol_sys
