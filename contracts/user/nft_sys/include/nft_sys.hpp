#pragma once

#include <psibase/Contract.hpp>
#include <psibase/String.hpp>
#include "errors.hpp"
#include "tables.hpp"

namespace UserContract
{
   class NftSys : public psibase::Contract<NftSys>
   {
     public:
      using tables = psibase::contract_tables<NftTable_t, AdTable_t>;
      static constexpr psibase::AccountNumber contract = "nft-sys"_a;

      NID  mint();
      void burn(NID nftId);
      void credit(NID                               nftId,
                  psibase::AccountNumber            receiver,
                  psio::const_view<psibase::String> memo);
      void uncredit(NID nftId, psio::const_view<psibase::String> memo);
      void debit(NID nftId, psio::const_view<psibase::String> memo);
      void autodebit(bool enable);

      // Read-only:
      std::optional<NftRecord> getNft(NID nftId);
      bool                     isAutodebit(psibase::AccountNumber account);

     private:
      tables db{contract};

      bool _exists(NID nftId);

     public:
      struct Events
      {
         using Account    = psibase::AccountNumber;
         using StringView = psio::const_view<psibase::String>;

         struct History
         {
            void minted(NID nftId, Account issuer) {}
            void burned(NID nftId) {}
            void disabledAutodeb(Account account) {}
            void enabledAutodeb(Account account) {}
         };

         struct Ui
         {
            void credited(NID nftId, Account sender, Account receiver, StringView memo) {}
            void uncredited(NID nftId, Account sender, Account receiver, StringView memo) {}
         };

         struct Merkle
         {
            void transferred(NID nftId, Account sender, Account receiver, StringView memo) {}
         };
      };
   };

   // clang-format off
   PSIO_REFLECT(NftSys, 
      method(mint), 
      method(burn, nftId),
      method(credit, nftId, receiver, memo),
      method(uncredit, nftId, memo),
      method(debit, nftId, memo),
      method(autodebit, enable),

      method(getNft, nftId),
      method(isAutodebit, account)
   );

   PSIBASE_REFLECT_HISTORY_EVENTS(NftSys,
      method(minted, nftId, issuer),
      method(burned, nftId),
      method(disabledAutodeb, account),
      method(enabledAutodeb, account)
   );

   PSIBASE_REFLECT_UI_EVENTS(NftSys, 
      method(credited, nftId, sender, receiver, memo),
      method(uncredited, nftId, sender, receiver, memo)
   );

   PSIBASE_REFLECT_MERKLE_EVENTS(NftSys, 
      method(transferred, nftId, sender, receiver, memo)
   );
   // clang-format on

}  // namespace UserContract
