#pragma once

#include <cstdint>
#include <psibase/Memo.hpp>
#include <psibase/psibase.hpp>

#include <services/system/CommonTables.hpp>
#include <services/user/nftErrors.hpp>
#include <services/user/nftTables.hpp>

namespace UserService
{
   class Nft : public psibase::Service
   {
     public:
      using Tables = psibase::ServiceTables<NftConfigTable, NftTable, NftHolderTable, CreditTable>;

      static constexpr auto         service     = psibase::AccountNumber("nft");
      static constexpr std::uint8_t manualDebit = 0;

      Nft(psio::shared_view_ptr<psibase::Action> action);

      void init();
      NID  mint();
      void burn(NID nftId);
      void credit(NID nftId, psibase::AccountNumber receiver, psio::view<const psibase::Memo> memo);
      void uncredit(NID nftId, psio::view<const psibase::Memo> memo);
      void debit(NID nftId, psio::view<const psibase::Memo> memo);
      void setUserConf(std::uint8_t flag, bool enable);

      // Read-only:
      NftRecord       getNft(NID nftId);
      NftHolderRecord getNftHolder(psibase::AccountNumber account);
      CreditRecord    getCredRecord(NID nftId);
      bool            exists(NID nftId);
      bool            getUserConf(psibase::AccountNumber account, std::uint8_t flag);

     public:
      struct Events
      {
         using Account  = psibase::AccountNumber;
         using MemoView = psio::view<const psibase::Memo>;
         // clang-format off
         struct History
         {
            void ownerChange(NID nftId, std::string action, Account prev_owner, Account new_owner, MemoView memo) {}
            void userConfSet(Account account, std::uint8_t flag, bool enable) {}
         };
         // clang-format on

         struct Ui
         {
         };

      };
   };

   // clang-format off
   PSIO_REFLECT(Nft,
      method(init),
      method(mint),
      method(burn, nftId),
      method(credit, nftId, receiver, memo),
      method(uncredit, nftId, memo),
      method(debit, nftId, memo),
      method(setUserConf, flag, enable),

      method(getNft, nftId),
      method(getNftHolder, account),
      method(getCredRecord, nftId),
      method(exists, nftId),
      method(getUserConf, account, flag)
   );
   PSIBASE_REFLECT_EVENTS(Nft);
   PSIBASE_REFLECT_HISTORY_EVENTS(Nft,
      method(userConfSet, account, flag, enable),
      method(ownerChange, nftId, action, prev_owner, new_owner, memo),
   );
   PSIBASE_REFLECT_UI_EVENTS(Nft);

   PSIBASE_REFLECT_TABLES(Nft, Nft::Tables)
   // clang-format on
}  // namespace UserService
