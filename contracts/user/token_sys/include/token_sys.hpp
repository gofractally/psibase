#pragma once

#include <psibase/Contract.hpp>
#include <psibase/String.hpp>
#include <psibase/check.hpp>
#include <string>
#include "symbol_tables.hpp"
#include "token_errors.hpp"
#include "token_sys.hpp"
#include "token_tables.hpp"
#include "types.hpp"

/* Boot notes:
 * NFT and token manualDebit flags should be set for the account holding this contract
*/

namespace UserContract
{

   class TokenSys : public psibase::Contract<TokenSys>
   {
     public:
      using tables                      = psibase::ContractTables<TokenTable_t,
                                             BalanceTable_t,
                                             SharedBalanceTable_t,
                                             TokenHolderTable_t,
                                             psibase::InitTable_t>;
      static constexpr auto contract    = psibase::AccountNumber("token-sys");
      static constexpr auto sysToken    = TID{1};
      static constexpr auto sysTokenSym = SID{"PSI"};

      TokenSys(psio::shared_view_ptr<psibase::Action> action);

      void init();

      TID create(Precision precision, Quantity maxSupply);

      void mint(TID tokenId, Quantity amount, psio::const_view<psibase::String> memo);

      void setUnrecallable(TID tokenId);

      //void lowerDailyInf(TID tokenId, uint8_t daily_limit_pct, Quantity daily_limit_qty);
      //void lowerYearlyInf(TID tokenId, uint8_t yearly_limit_pct, Quantity yearly_limit_qty);

      void burn(TID tokenId, Quantity amount);

      void setConfig(psibase::NamedBit_t flag, bool enable);

      void credit(TID                               tokenId,
                  psibase::AccountNumber            receiver,
                  Quantity                          amount,
                  psio::const_view<psibase::String> memo);

      void uncredit(TID                               tokenId,
                    psibase::AccountNumber            receiver,
                    Quantity                          maxAmount,
                    psio::const_view<psibase::String> memo);

      void debit(TID                               tokenId,
                 psibase::AccountNumber            sender,
                 Quantity                          amount,
                 psio::const_view<psibase::String> memo);

      void recall(TID                               tokenId,
                  psibase::AccountNumber            from,
                  Quantity                          amount,
                  psio::const_view<psibase::String> memo);

      void mapSymbol(TID tokenId, SID symbolId);

      // Read-only interface:
      TokenRecord         getToken(TID tokenId);
      SymbolRecord        getSymbol(TID tokenId);
      bool                exists(TID tokenId);
      BalanceRecord       getBalance(TID tokenId, psibase::AccountNumber account);
      SharedBalanceRecord getSharedBal(TID                    tokenId,
                                       psibase::AccountNumber creditor,
                                       psibase::AccountNumber debitor);
      TokenHolderRecord   getTokenHolder(psibase::AccountNumber account);
      bool                getConfig(psibase::AccountNumber account, psibase::NamedBit_t flag);

     private:
      tables db{contract};

      void _checkAccountValid(psibase::AccountNumber account);

     public:
      struct Events
      {
         using Account    = psibase::AccountNumber;
         using StringView = psio::const_view<psibase::String>;

         // clang-format off
         struct Ui  // History <-- Todo - Change back to History
         {
            void initialized() {}
            void created(TID tokenId, Account creator, Precision precision, Quantity maxSupply) {}
            void minted(TID tokenId, Account minter, Quantity amount, StringView memo) {}
            void setUnrecallable(TID tokenId, Account setter) {}
            void burned(TID tokenId, Account burner, Quantity amount) {}
            void configChanged(Account account, psibase::NamedBit_t flag, bool enable) {}
            void symbolMapped(TID tokenId, Account account, SID symbolId) {}
            //};

            //struct Ui
            //{
            void credited(TID tokenId, Account sender, Account receiver, Quantity amount, StringView memo) {}
            void uncredited(TID tokenId, Account sender, Account receiver, Quantity amount, StringView memo) {}
            //};

            //struct Merkle
            //{
            void transferred(TID tokenId, Account sender, Account receiver, Quantity amount, StringView memo) {}
            void recalled(TID tokenId, Account from, Quantity amount, StringView memo) {}
         };
      };
      // clang-format on
   };

   // clang-format off
   PSIO_REFLECT(TokenSys,
      method(init),
      method(create, precision, maxSupply),
      method(mint, tokenId, amount, memo),
      method(setUnrecallable, tokenId, flag),
      
      method(burn, tokenId, amount),
      method(setConfig, flag, enable),
      method(credit, tokenId, receiver, amount, memo),
      method(uncredit, tokenId, receiver, maxAmount, memo),
      method(debit, tokenId, sender, amount, memo),
      method(recall, tokenId, from, amount, memo),
      method(getToken, tokenId),
      method(getSymbol, tokenId),
      method(exists, tokenId),
      method(getBalance, tokenId, account),
      method(getSharedBal, tokenId, creditor, debitor),
      method(getConfig, account, flag),
      method(mapSymbol, symbolId, tokenId)
    );
   PSIBASE_REFLECT_UI_EVENTS(TokenSys, // Change to history
      method(initialized),
      method(created, tokenId, creator, precision, maxSupply),
      method(minted, tokenId, minter, amount, memo),
      method(setUnrecallable, tokenId, setter),
      method(burned, tokenId, burner, amount),
      method(configChanged, account, flag, enable),
      method(symbolMapped, tokenId, account, symbolId),
   //);
   //PSIBASE_REFLECT_UI_EVENTS(TokenSys, 
      method(credited, tokenId, sender, receiver, amount, memo),
      method(uncredited, tokenId, sender, receiver, amount, memo),
   //);
   //PSIBASE_REFLECT_MERKLE_EVENTS(TokenSys, 
      method(transferred, tokenId, sender, receiver, amount, memo),
      method(recalled, tokenId, from, amount, memo)
   );
   // clang-format on

}  // namespace UserContract