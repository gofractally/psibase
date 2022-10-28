#pragma once

#include <psibase/Rpc.hpp>
#include <psibase/Service.hpp>
#include <psibase/String.hpp>
#include <psibase/check.hpp>
#include <psibase/eventIndex.hpp>
#include <string>

#include <services/user/symbolTables.hpp>
#include <services/user/tokenErrors.hpp>
#include <services/user/tokenTables.hpp>
#include <services/user/tokenTypes.hpp>

namespace UserService
{
   class TokenSys : public psibase::Service<TokenSys>
   {
     public:
      using Tables = psibase::
          ServiceTables<TokenTable, BalanceTable, SharedBalanceTable, TokenHolderTable, InitTable>;

      static constexpr auto service  = psibase::AccountNumber("token-sys");
      static constexpr auto sysToken = TID{1};

      TokenSys(psio::shared_view_ptr<psibase::Action> action);

      void init();

      TID create(Precision precision, Quantity maxSupply);

      void mint(TID tokenId, Quantity amount, psio::const_view<psibase::String> memo);

      //void lowerDailyInf(TID tokenId, uint8_t daily_limit_pct, Quantity daily_limit_qty);
      //void lowerYearlyInf(TID tokenId, uint8_t yearly_limit_pct, Quantity yearly_limit_qty);

      void burn(TID tokenId, Quantity amount);

      void setUserConf(psibase::NamedBit flag, bool enable);
      void setTokenConf(TID tokenId, psibase::NamedBit flag, bool enable);

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
      bool                getUserConf(psibase::AccountNumber account, psibase::NamedBit flag);
      bool                getTokenConf(TID tokenId, psibase::NamedBit flag);

     private:
      Tables db{psibase::getReceiver()};

      void checkAccountValid(psibase::AccountNumber account);
      bool isSenderIssuer(TID tokenId);

     public:
      struct Events
      {
         using Account    = psibase::AccountNumber;
         using StringView = psio::const_view<psibase::String>;

         // clang-format off
         struct History
         {
            void initialized() {}
            void created(TID tokenId, Account creator, Precision precision, Quantity maxSupply) {}
            void minted(uint64_t prevEvent, TID tokenId, Account minter, Quantity amount, StringView memo) {}
            void burned(uint64_t prevEvent, TID tokenId, Account burner, Quantity amount) {}
            void userConfSet(Account account, psibase::NamedBit flag, bool enable) {}
            void tokenConfSet(uint64_t prevEvent, TID tokenId, Account setter, psibase::NamedBit flag, bool enable) {}
            void symbolMapped(uint64_t prevEvent, TID tokenId, Account account, SID symbolId) {}
            // TODO: time is redundant with which block the event was written in
            void transferred(uint64_t prevEvent, TID tokenId, psibase::TimePointSec time, Account sender, Account receiver, Quantity amount, StringView memo) {}
            void recalled(uint64_t prevEvent, TID tokenId, psibase::TimePointSec time, Account from, Quantity amount, StringView memo) {}
         };

         struct Ui {};

         struct Merkle{};
      };
      using UserEvents = psibase::EventIndex<&TokenHolderRecord::lastHistoryEvent, "prevEvent">;

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
   PSIBASE_REFLECT_EVENTS(TokenSys)
   PSIBASE_REFLECT_HISTORY_EVENTS(TokenSys,
      method(initialized),
      method(created, tokenId, creator, precision, maxSupply),
      method(minted, prevEvent, tokenId, minter, amount, memo),
      method(burned, prevEvent, tokenId, burner, amount),
      method(userConfSet, account, flag, enable),
      method(tokenConfSet, prevEvent, tokenId, setter, flag, enable),
      method(symbolMapped, prevEvent, tokenId, account, symbolId),
      method(transferred, prevEvent, tokenId, time, sender, receiver, amount, memo),
      method(recalled, prevEvent, tokenId, time, from, amount, memo),
   );
   PSIBASE_REFLECT_UI_EVENTS(TokenSys);
   PSIBASE_REFLECT_MERKLE_EVENTS(TokenSys);
   // clang-format on

}  // namespace UserService
