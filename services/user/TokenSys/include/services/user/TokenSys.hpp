#pragma once

#include <psibase/Rpc.hpp>
#include <psibase/Service.hpp>
#include <psibase/String.hpp>
#include <psibase/check.hpp>
#include <string>

#include <services/user/tokenErrors.hpp>
#include <services/user/tokenTables.hpp>
#include <services/user/tokenTypes.hpp>
#include "services/user/symbolTables.hpp"

namespace psibase
{

   // This does nothing, but causes an error when called from a `consteval` function.
   inline void expectedNullTerminatedArray() {}

   // StringLiteral idea taken from:
   // https://stackoverflow.com/questions/68024563/passing-a-string-literal-to-a-template-char-array-parameter
   template <size_t N>
   struct StringLiteral
   {
      char str[N]{};

      static constexpr size_t size = N - 1;

      consteval StringLiteral() {}
      consteval StringLiteral(const char (&new_str)[N])
      {
         if (new_str[N - 1] != '\0')
            expectedNullTerminatedArray();
         std::copy_n(new_str, size, str);
      }
   };

   template <auto eventHead, StringLiteral eventPtrField>  //,
   struct EventIndex
   {
      // type-dependent expression silences failure unless instantiated
      static_assert(sizeof(decltype(eventHead)) != sizeof(decltype(eventHead)),
                    "Failed to extract eventHead and eventPtrField from EventIndex definition");
   };

   template <typename RecordType,
             typename KeyType,
             KeyType RecordType::*eventHead,
             StringLiteral        eventPtrField>
   struct EventIndex<eventHead, eventPtrField>
   {
      static constexpr auto             evHead = eventHead;
      static constexpr std::string_view prevField{eventPtrField.str};
   };

}  // namespace psibase

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
            void minted(TID tokenId, uint64_t prevEvent, Account minter, Quantity amount, StringView memo) {}
            void burned(TID tokenId, uint64_t prevEvent, Account burner, Quantity amount) {}
            void userConfSet(Account account, psibase::NamedBit flag, bool enable) {}
            void tokenConfSet(TID tokenId, uint64_t prevEvent, Account setter, psibase::NamedBit flag, bool enable) {}
            void symbolMapped(TID tokenId, uint64_t prevEvent, Account account, SID symbolId) {}
            // TODO: time is redundant with which block the event was written in
            void transferred(TID tokenId, uint64_t prevEvent, psibase::TimePointSec time, Account sender, Account receiver, Quantity amount, StringView memo) {}
            void recalled(TID tokenId, uint64_t prevEvent, psibase::TimePointSec time, Account from, Quantity amount, StringView memo) {}
         };

         struct Ui
         {
            void credited(TID tokenId, Account sender, Account receiver, Quantity amount, StringView memo) {}
            void uncredited(TID tokenId, Account sender, Account receiver, Quantity amount, StringView memo) {}
         };

         struct Merkle
         {
            void transferred(TID tokenId, Account sender, Account receiver, Quantity amount, StringView memo) {}
            void recalled(TID tokenId, Account from, Quantity amount, StringView memo) {}
         };
      };
      using HolderEvents = psibase::EventIndex<&TokenHolderRecord::lastHistoryEvent, "prevEvent">;
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
      method(transferred, tokenId, prevEvent, time, sender, receiver, amount, memo),
      method(recalled, tokenId, prevEvent, time, from, amount, memo),
   );
   PSIBASE_REFLECT_UI_EVENTS(TokenSys,
      method(credited, tokenId, sender, receiver, amount, memo),
      method(uncredited, tokenId, sender, receiver, amount, memo),
   );
   PSIBASE_REFLECT_MERKLE_EVENTS(TokenSys,
      method(transferred, tokenId, sender, receiver, amount, memo),
      method(recalled, tokenId, from, amount, memo)
   );
   // clang-format on

}  // namespace UserService
