#pragma once

#include <psibase/Contract.hpp>
#include <psibase/Rpc.hpp>
#include <psibase/String.hpp>
#include <psibase/check.hpp>
#include <psibase/serveContent.hpp>
#include <string>

#include <contracts/user/tokenErrors.hpp>
#include <contracts/user/tokenTables.hpp>
#include <contracts/user/tokenTypes.hpp>
#include "contracts/user/symbolTables.hpp"

namespace UserContract
{

   class TokenSys : public psibase::Contract<TokenSys>
   {
     public:
      using Tables                      = psibase::ContractTables<TokenTable_t,
                                             BalanceTable_t,
                                             SharedBalanceTable_t,
                                             TokenHolderTable_t,
                                             InitTable_t,
                                             psibase::WebContentTable>;
      static constexpr auto contract    = psibase::AccountNumber("token-sys");
      static constexpr auto sysToken    = TID{1};
      static constexpr auto sysTokenSym = SID{"PSI"};

      TokenSys(psio::shared_view_ptr<psibase::Action> action);

      void init();

      TID create(Precision precision, Quantity maxSupply);

      void mint(TID tokenId, Quantity amount, psio::const_view<psibase::String> memo);

      //void lowerDailyInf(TID tokenId, uint8_t daily_limit_pct, Quantity daily_limit_qty);
      //void lowerYearlyInf(TID tokenId, uint8_t yearly_limit_pct, Quantity yearly_limit_qty);

      void burn(TID tokenId, Quantity amount);

      void setUserConf(psibase::NamedBit_t flag, bool enable);
      void setTokenConf(TID tokenId, psibase::NamedBit_t flag, bool enable);

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
      SID                 getTokenSymbol(TID tokenId);
      bool                exists(TID tokenId);
      BalanceRecord       getBalance(TID tokenId, psibase::AccountNumber account);
      SharedBalanceRecord getSharedBal(TID                    tokenId,
                                       psibase::AccountNumber creditor,
                                       psibase::AccountNumber debitor);
      TokenHolderRecord   getTokenHolder(psibase::AccountNumber account);
      bool                getUserConf(psibase::AccountNumber account, psibase::NamedBit_t flag);
      bool                getTokenConf(TID tokenId, psibase::NamedBit_t flag);

     private:
      Tables db{contract};

      void _checkAccountValid(psibase::AccountNumber account);
      bool _isSenderIssuer(TID tokenId);

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
            void burned(TID tokenId, Account burner, Quantity amount) {}
            void userConfSet(Account account, psibase::NamedBit_t flag, bool enable) {}
            void tokenConfSet(TID tokenId, Account setter, psibase::NamedBit_t flag, bool enable) {}
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
      
      method(burn, tokenId, amount),
      method(setUserConf, flag, enable),
      method(setTokenConf, tokenId, flag, enable),
      method(credit, tokenId, receiver, amount, memo),
      method(uncredit, tokenId, receiver, maxAmount, memo),
      method(debit, tokenId, sender, amount, memo),
      method(recall, tokenId, from, amount, memo),
      method(getToken, tokenId),
      method(getTokenSymbol, tokenId),
      method(exists, tokenId),
      method(getBalance, tokenId, account),
      method(getSharedBal, tokenId, creditor, debitor),
      method(getUserConf, account, flag),
      method(getTokenConf, tokenId, flag),
      method(mapSymbol, symbolId, tokenId),
    );
   PSIBASE_REFLECT_UI_EVENTS(TokenSys, // Change to history
      method(initialized),
      method(created, tokenId, creator, precision, maxSupply),
      method(minted, tokenId, minter, amount, memo),
      method(burned, tokenId, burner, amount),
      method(userConfSet, account, flag, enable),
      method(tokenConfSet, tokenId, setter, flag, enable),
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