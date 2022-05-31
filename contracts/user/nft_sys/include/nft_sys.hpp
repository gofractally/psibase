#pragma once

#include <psibase/Contract.hpp>
#include <psibase/String.hpp>
#include "nft_errors.hpp"
#include "nft_tables.hpp"

namespace UserContract
{
   class NftSys : public psibase::Contract<NftSys>
   {
     public:
      using tables =
          psibase::ContractTables<NftTable_t, NftHolderTable_t, CreditTable_t, InitTable_t>;

      static constexpr auto contract = psibase::AccountNumber("nft-sys");

      NftSys(psio::shared_view_ptr<psibase::Action> action);

      void init();
      NID  mint();
      void burn(NID nftId);
      void credit(NID                               nftId,
                  psibase::AccountNumber            receiver,
                  psio::const_view<psibase::String> memo);
      void uncredit(NID nftId, psio::const_view<psibase::String> memo);
      void debit(NID nftId, psio::const_view<psibase::String> memo);
      void setUserConf(psibase::NamedBit_t flag, bool enable);

      // Read-only:
      NftRecord       getNft(NID nftId);
      NftHolderRecord getNftHolder(psibase::AccountNumber account);
      CreditRecord    getCredRecord(NID nftId);
      bool            exists(NID nftId);
      bool            getUserConf(psibase::AccountNumber account, psibase::NamedBit_t flag);

     private:
      tables db{contract};

     public:
      struct Events
      {
         using Account    = psibase::AccountNumber;
         using StringView = psio::const_view<psibase::String>;

         struct Ui  // Todo - change to History, once more than UI events are supported
         {
            void initialized() {}
            void minted(NID nftId, Account issuer) {}
            void burned(NID nftId) {}
            void userConfSet(Account account, psibase::NamedBit_t flag, bool enable) {}
            //};

            //struct Ui
            //{
            void credited(NID nftId, Account sender, Account receiver, StringView memo) {}
            void uncredited(NID nftId, Account sender, Account receiver, StringView memo) {}
            //};

            //struct Merkle
            //{
            void transferred(NID nftId, Account sender, Account receiver, StringView memo) {}
         };
      };
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

      method(getNft, nftId),
      method(getNftHolder, account),
      method(getCredRecord, nftid),
      method(exists, nftId),
      method(getUserConf, account, flag)
   );

   PSIBASE_REFLECT_UI_EVENTS(NftSys, // Todo - change to _HISTORY_ once more than UI events are supported
      method(initialized),
      method(minted, nftId, issuer),
      method(burned, nftId),
      method(userConfSet, account, flag, enable),
   //);

   //PSIBASE_REFLECT_UI_EVENTS(NftSys, 
      method(credited, nftId, sender, receiver, memo),
      method(uncredited, nftId, sender, receiver, memo),
   //);

   //PSIBASE_REFLECT_MERKLE_EVENTS(NftSys, 
      method(transferred, nftId, sender, receiver, memo)
   );
   // clang-format on

}  // namespace UserContract
