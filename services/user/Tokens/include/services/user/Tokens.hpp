#pragma once

#include <psibase/Memo.hpp>
#include <psibase/psibase.hpp>

#include <services/system/CommonTables.hpp>
#include <services/user/symbolTables.hpp>
#include <services/user/tokenErrors.hpp>
#include <services/user/tokenTables.hpp>
#include <services/user/tokenTypes.hpp>

namespace UserService
{
   class Tokens : public psibase::Service
   {
     public:
      using Tables = psibase::
          ServiceTables<TokenTable, BalanceTable, SharedBalanceTable, TokenHolderTable, InitTable>;

      static constexpr auto service  = psibase::AccountNumber("tokens");
      static constexpr auto sysToken = TID{1};

      Tokens(psio::shared_view_ptr<psibase::Action> action);

      void init();

      TID create(Precision precision, Quantity maxSupply);

      void mint(TID tokenId, Quantity amount, psio::view<const psibase::Memo> memo);
      void burn(TID tokenId, Quantity amount, psio::view<const psibase::Memo> memo);

      void setUserConf(psibase::EnumElement flag, bool enable);
      void setTokenConf(TID tokenId, psibase::EnumElement flag, bool enable);

      void credit(TID                             tokenId,
                  psibase::AccountNumber          receiver,
                  Quantity                        amount,
                  psio::view<const psibase::Memo> memo);

      void uncredit(TID                             tokenId,
                    psibase::AccountNumber          receiver,
                    Quantity                        maxAmount,
                    psio::view<const psibase::Memo> memo);

      void debit(TID                             tokenId,
                 psibase::AccountNumber          sender,
                 Quantity                        amount,
                 psio::view<const psibase::Memo> memo);

      void recall(TID                             tokenId,
                  psibase::AccountNumber          from,
                  Quantity                        amount,
                  psio::view<const psibase::Memo> memo);

      void map_symbol(TID tokenId, SID symbolId);

      // Read-only interface:
      TokenRecord         getToken(TID tokenId);
      SID                 getTokenSymbol(TID tokenId);
      bool                exists(TID tokenId);
      BalanceRecord       getBalance(TID tokenId, psibase::AccountNumber account);
      SharedBalanceRecord getSharedBal(TID                    tokenId,
                                       psibase::AccountNumber creditor,
                                       psibase::AccountNumber debitor);
      TokenHolderRecord   getTokHoldr(psibase::AccountNumber account);
      bool                getUserConf(psibase::AccountNumber account, psibase::EnumElement flag);
      bool                getTokenConf(TID tokenId, psibase::EnumElement flag);

     private:
      void checkAccountValid(psibase::AccountNumber account);
      bool isSenderIssuer(TID tokenId);

     public:
      struct Events
      {
         using Account  = psibase::AccountNumber;
         using MemoView = psio::view<const psibase::Memo>;

         // clang-format off
         struct History
         {
            void created(TID tokenId, Account creator, Precision precision, Quantity maxSupply) {}
            void minted(TID tokenId, Account minter, Quantity amount, MemoView memo) {}
            void burned(TID tokenId, Account burner, Quantity amount, MemoView memo) {}
            void userConfSet(Account account, psibase::EnumElement flag, bool enable) {}
            void tokenConfSet(TID tokenId, Account setter, psibase::EnumElement flag, bool enable) {}
            void symbolMapped(TID tokenId, Account account, SID symbolId) {}
            // TODO: time is redundant with which block the event was written in
            void transferred(TID tokenId, psibase::BlockTime time, Account sender, Account receiver, Quantity amount, MemoView memo) {}
            void recalled(TID tokenId, psibase::BlockTime time, Account from, Quantity amount, MemoView memo) {}
         };

         struct Ui {};

         struct Merkle{};
      };
      // clang-format on
   };

   // clang-format off
   PSIO_REFLECT(Tokens,
      method(init),
      method(create, precision, maxSupply),
      method(mint, tokenId, amount, memo),

      method(burn, tokenId, amount),
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
      method(map_symbol, symbolId, tokenId),
    );
   PSIBASE_REFLECT_EVENTS(Tokens);
   PSIBASE_REFLECT_HISTORY_EVENTS(Tokens,
      method(created, tokenId, creator, precision, maxSupply),
      method(minted, tokenId, minter, amount, memo),
      method(burned, tokenId, burner, amount),
      method(userConfSet, account, flag, enable),
      method(tokenConfSet, tokenId, setter, flag, enable),
      method(symbolMapped, tokenId, account, symbolId),
      method(transferred, tokenId, time, sender, receiver, amount, memo),
      method(recalled, tokenId, time, from, amount, memo),
   );
   PSIBASE_REFLECT_UI_EVENTS(Tokens);
   PSIBASE_REFLECT_MERKLE_EVENTS(Tokens);
   PSIBASE_REFLECT_TABLES(Tokens, Tokens::Tables)
   // clang-format on

}  // namespace UserService
