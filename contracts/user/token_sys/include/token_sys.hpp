#pragma once

#include <psibase/Contract.hpp>
#include <psibase/String.hpp>
#include <string>
#include "tables.hpp"
#include "token_sys.hpp"
#include "types.hpp"

/* 04/18/2022
 * James and Dan call notes:
 * Token IDs are auto-increment only. Reserve the first bit, so there's only 31 bits used for token ID.
 *    This is so that in the future we have a bit to play with if we want to add some capabilities to token IDs, such as 
 *    the ability to store them in a separate namespace as human readable IDs that roundtrip our compression algo.
 * Symbols are still handled by symbol table, 32 bit symbols, only uppercase, no numbers
 * Symbols are mapped to NIDs, which can be burned in the NFT contract, but the symbol table will always hold on to Symbol->NID mapping
 * Symbol IDs can be specified in a separate action on the token contract to permanently map the symbol to the token (burns underlying NFT)
 * 
*/

namespace UserContract
{
   class TokenSys : public psibase::contract
   {
     public:
      using tables = psibase::contract_tables<TokenTable_t, BalanceTable_t, SharedBalanceTable_t>;
      static constexpr psibase::AccountNumber contract = "token-sys"_a;

      TID  create(Precision precision, Quantity max_supply);
      void mint(TID tokenId, Quantity amount, psibase::AccountNumber receiver);

      void unrecallable(TID tokenId);

      void lowerDailyInf(TID tokenId, uint8_t daily_limit_pct, Quantity daily_limit_qty);
      void lowerYearlyInf(TID tokenId, uint8_t yearly_limit_pct, Quantity yearly_limit_qty);

      void burn(TID tokenId, Quantity amount);
      void autodebit(bool enable);
      void credit(TID                               tokenId,
                  psibase::AccountNumber            receiver,
                  Quantity                          amount,
                  psio::const_view<psibase::String> memo);
      void uncredit(TID                               tokenId,
                    psibase::AccountNumber            receiver,
                    Quantity                          amount,
                    psio::const_view<psibase::String> memo);
      void debit(TID                               tokenId,
                 psibase::AccountNumber            sender,
                 Quantity                          amount,
                 psio::const_view<psibase::String> memo);

      std::optional<TokenRecord> getToken(TID tokenId);
      bool                       isAutodebit(psibase::AccountNumber account);

     private:
      tables db{contract};

      bool _exists(TID tokenId);
   };

   // clang-format off
   PSIO_REFLECT(TokenSys,
      method(create, precision, max_supply),
      method(mint, tokenId, amount, receiver),
      method(unrecallable, tokenId),

      method(burn, tokenId, amount),
      method(autodebit, enable),
      method(credit, tokenId, receiver, amount, memo),
      method(uncredit, tokenId, receiver, amount, memo),
      method(debit, tokenId, sender, amount, memo),
      method(getToken, tokenId),
      method(isAutodebit)
    );
   // clang-format on

}  // namespace UserContract