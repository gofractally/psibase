#pragma once

#include <psibase/String.hpp>
#include <psibase/psibase.hpp>

#include <services/user/nftErrors.hpp>
#include <services/user/nftTables.hpp>

namespace UserService
{
   class NftSys : public psibase::Service<NftSys>
   {
     public:
      using Tables = psibase::ServiceTables<NftTable, NftHolderTable, CreditTable, InitTable>;

      static constexpr auto service = psibase::AccountNumber("nft-sys");

      NftSys(psio::shared_view_ptr<psibase::Action> action);

      void init();
      NID  mint();
      void burn(NID nftId);
      void credit(NID                               nftId,
                  psibase::AccountNumber            receiver,
                  psio::view<const psibase::String> memo);
      void uncredit(NID nftId, psio::view<const psibase::String> memo);
      void debit(NID nftId, psio::view<const psibase::String> memo);
      void setUserConf(psibase::NamedBit flag, bool enable);

      std::optional<psibase::HttpReply> serveSys(psibase::HttpRequest request);

      // Read-only:
      NftRecord       getNft(NID nftId);
      NftHolderRecord getNftHolder(psibase::AccountNumber account);
      CreditRecord    getCredRecord(NID nftId);
      bool            exists(NID nftId);
      bool            getUserConf(psibase::AccountNumber account, psibase::NamedBit flag);

     public:
      struct Events
      {
         using Account    = psibase::AccountNumber;
         using StringView = psio::view<const psibase::String>;
         // clang-format off
         struct History
         {
            void minted(uint64_t prevEvent, NID nftId, Account issuer) {}
            void burned(uint64_t prevEvent, NID nftId) {}
            void userConfSet(uint64_t prevEvent, Account account, psibase::NamedBit flag, bool enable) {}
            void credited(uint64_t prevEvent, NID nftId, Account sender, Account receiver, StringView memo) {}
            void uncredited(uint64_t prevEvent, NID nftId, Account sender, Account receiver, StringView memo) {}
            void transferred(uint64_t prevEvent, NID nftId, Account creditor, Account debitor, StringView memo) {}
         };
         // clang-format on

         struct Ui
         {
         };
         struct Merkle
         {
         };
      };
      using NftEvents  = psibase::EventIndex<&NftRecord::eventHead, "prevEvent">;
      using UserEvents = psibase::EventIndex<&NftHolderRecord::eventHead, "prevEvent">;
   };

   // clang-format off
   PSIO_REFLECT(NftSys,
      method(init),
      method(mint),
      method(burn, nftId),
      method(credit, nftId, receiver, memo),
      method(uncredit, nftId, memo),
      method(debit, nftId, memo),
      method(setUserConf, flag, enable),
      method(serveSys, request),

      method(getNft, nftId),
      method(getNftHolder, account),
      method(getCredRecord, nftId),
      method(exists, nftId),
      method(getUserConf, account, flag)
   );
   PSIBASE_REFLECT_EVENTS(NftSys);
   PSIBASE_REFLECT_HISTORY_EVENTS(NftSys,
      method(minted, prevEvent, nftId, issuer),
      method(burned, prevEvent, nftId),
      method(userConfSet, prevEvent, account, flag, enable),
      method(credited, prevEvent, nftId, sender, receiver, memo),
      method(uncredited, prevEvent, nftId, sender, receiver, memo),
      method(transferred, prevEvent, nftId, creditor, debitor, memo)
   );
   PSIBASE_REFLECT_UI_EVENTS(NftSys);
   PSIBASE_REFLECT_MERKLE_EVENTS(NftSys);

   // clang-format on

}  // namespace UserService
