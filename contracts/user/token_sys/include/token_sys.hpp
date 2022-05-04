#pragma once

#include <psibase/Contract.hpp>
#include <psibase/String.hpp>
#include <psibase/check.hpp>
#include <string>
#include "errors.hpp"
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
   class TokenSys : public psibase::Contract<TokenSys>
   {
     public:
      using tables = psibase::
          contract_tables<TokenTable_t, BalanceTable_t, SharedBalanceTable_t, TokenHolderTable_t>;
      static constexpr psibase::AccountNumber contract = "token-sys"_a;

      TID  create(Precision precision, Quantity maxSupply);
      void mint(TID                               tokenId,
                Quantity                          amount,
                psibase::AccountNumber            receiver,
                psio::const_view<psibase::String> memo);

      void setUnrecallable(TID tokenId);

      //void lowerDailyInf(TID tokenId, uint8_t daily_limit_pct, Quantity daily_limit_qty);
      //void lowerYearlyInf(TID tokenId, uint8_t yearly_limit_pct, Quantity yearly_limit_qty);

      void burn(TID tokenId, Quantity amount);
      void manualDebit(bool enable);
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
      void recall(TID                               tokenId,
                  psibase::AccountNumber            from,
                  psibase::AccountNumber            to,
                  Quantity                          amount,
                  psio::const_view<psibase::String> memo);

      // Read-only interface:
      TokenRecord         getToken(TID tokenId);
      bool                exists(TID tokenId);
      BalanceRecord       getBalance(TID tokenId, psibase::AccountNumber account);
      SharedBalanceRecord getSharedBal(TID                    tokenId,
                                       psibase::AccountNumber creditor,
                                       psibase::AccountNumber debitor);
      TokenHolderRecord   getTokenHolder(psibase::AccountNumber account);
      bool                isManualDebit(psibase::AccountNumber account);

     private:
      tables db{contract};

      void _checkAccountValid(psibase::AccountNumber account);

     public:
      struct Events
      {
         using Account    = psibase::AccountNumber;
         using StringView = psio::const_view<psibase::String>;

         struct Ui  // History <-- Todo - Change back to History
         {
            void created(TID tokenId, Account creator, Precision precision, Quantity maxSupply) {}
            void minted(TID        tokenId,
                        Account    minter,
                        Quantity   amount,
                        Account    receiver,
                        StringView memo)
            {
            }
            void set(TID tokenId, Account setter, uint8_t flag) {}
            void burned(TID tokenId, Account burner, Quantity amount) {}

            void enabledManDeb(Account account) {}
            void disabledManDeb(Account account) {}
            //};

            //struct Ui
            //{
            void credited(TID        tokenId,
                          Account    sender,
                          Account    receiver,
                          Quantity   amount,
                          StringView memo)
            {
            }
            void uncredited(TID        tokenId,
                            Account    sender,
                            Account    receiver,
                            Quantity   amount,
                            StringView memo)
            {
            }
            //};

            //struct Merkle
            //{
            void transferred(TID        tokenId,
                             Account    sender,
                             Account    receiver,
                             Quantity   amount,
                             StringView memo)
            {
            }
            void recalled(TID tokenId, Account from, Account to, Quantity amount, StringView memo)
            {
            }
         };
      };
   };

   // clang-format off
   PSIO_REFLECT(TokenSys,
      method(create, precision, maxSupply),
      method(mint, tokenId, amount, receiver, memo),
      method(setUnrecallable, tokenId, flag),
      
      method(burn, tokenId, amount),
      method(manualDebit, enable),
      method(credit, tokenId, receiver, amount, memo),
      method(uncredit, tokenId, receiver, amount, memo),
      method(debit, tokenId, sender, amount, memo),
      method(recall, tokenId, from, to, amount, memo),
      method(getToken, tokenId),
      method(exists, tokenId),
      method(getBalance, tokenId, account),
      method(getSharedBal, tokenId, creditor, debitor),
      method(isManualDebit)
    );
   PSIBASE_REFLECT_UI_EVENTS(TokenSys, 
      method(created, tokenId, creator, precision, maxSupply),
      method(minted, tokenId, minter, amount, receiver, memo),
      method(set, tokenId, setter, flag),
      method(burned, tokenId, burner, amount),
      method(enabledManDeb, account),
      method(disabledManDeb, account),
   //);
   //PSIBASE_REFLECT_UI_EVENTS(TokenSys, 
      method(credited, tokenId, sender, receiver, amount, memo),
      method(uncredited, tokenId, sender, receiver, amount, memo),
   //);
   //PSIBASE_REFLECT_MERKLE_EVENTS(TokenSys, 
      method(transferred, tokenId, sender, receiver, amount, memo),
      method(recalled, tokenId, from, to, amount, memo)
   );
   // clang-format on

}  // namespace UserContract