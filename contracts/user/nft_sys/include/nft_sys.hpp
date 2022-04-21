#pragma once

#include <psibase/String.hpp>
#include <psibase/contract.hpp>
#include "errors.hpp"
#include "tables.hpp"

namespace UserContract
{
   class NftSys : public psibase::contract2<NftSys>
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
         struct UI
         {
            void credited(NID nftId, Account sender, Account receiver, StringView memo) {}
            void uncredited(NID nftId, Account sender, Account receiver, StringView memo) {}
         };
         struct History
         {
            void minted(NID nftId, Account issuer) {}
            void burned(NID nftId) {}
            void disabledAutodebit(Account account) {}
            void enabledAutodebit(Account account) {}
         };
         struct Merkle
         {
            void transferred(NID nftId, Account sender, Account receiver, StringView memo) {}
         };

         UI      ui;
         History history;
         Merkle  merkle;
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

   // PSIO_REFLECT_EVENTS(NftSys,
   //    method(minted, nftId, issuer),
   //    method(burned, nftId),
   //    method(disabledAutodebit, account),
   //    method(enabledAutodebit, account),
   //    method(credited, nftId, sender, receiver, memo),
   //    method(transferred, nftId, sender, receiver, memo),
   //    method(uncredited, nftId, sender, receiver, memo)
   // );
   // clang-format on

}  // namespace UserContract
