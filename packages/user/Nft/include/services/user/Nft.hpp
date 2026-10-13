#pragma once

#include <cstdint>
#include <optional>
#include <vector>
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
      using Tables = psibase::ServiceTables<NftConfigTable,
                                            NftTable,
                                            NftHolderTable,
                                            CreditTable,
                                            UserPendingTable,
                                            BurnedTable>;

      static constexpr auto         service   = psibase::AccountNumber("nft");
      static constexpr std::uint8_t autoDebit = 0;

      Nft(psio::shared_view_ptr<psibase::Action> action);

      void init();
      NID  mint(std::optional<NID> nftId);
      void burn(NID nftId);
      void credit(NID nftId, psibase::AccountNumber receiver, psio::view<const psibase::Memo> memo);
      void uncredit(NID nftId, psio::view<const psibase::Memo> memo);
      void debit(NID nftId, psio::view<const psibase::Memo> memo);
      void try_debit(NID nftId, psio::view<const psibase::Memo> memo);
      void setUserConf(std::uint8_t flag, bool enable);

      // Read-only:
      std::optional<NftRecord> getNft(NID nftId);
      std::vector<NID>         getHeldIds(psibase::AccountNumber issuer, psibase::AccountNumber owner);
      NftHolderRecord          getNftHolder(psibase::AccountNumber account);
      CreditRecord             getCredRecord(NID nftId);
      bool                     exists(NID nftId);
      bool                     getUserConf(psibase::AccountNumber account, std::uint8_t flag);

     public:
      struct Events
      {
         using Account  = psibase::AccountNumber;
         using MemoView = psio::view<const psibase::Memo>;
         // clang-format off
         struct History
         {
            void ownerChange(NID nftId, std::uint8_t action, Account account, Account counter_party, MemoView memo) {}
         };
         // clang-format on
      };
   };

   // clang-format off
   PSIO_REFLECT(Nft,
      method(init),
      method(mint, nftId),
      method(burn, nftId),
      method(credit, nftId, receiver, memo),
      method(uncredit, nftId, memo),
      method(debit, nftId, memo),
      method(try_debit, nftId, memo),
      method(setUserConf, flag, enable),

      method(getNft, nftId),
      method(getHeldIds, issuer, owner),
      method(getNftHolder, account),
      method(getCredRecord, nftId),
      method(exists, nftId),
      method(getUserConf, account, flag)
   );
   PSIBASE_REFLECT_HISTORY_EVENTS(Nft,
      method(ownerChange, nftId, action, account, counter_party, memo),
   );

   PSIBASE_REFLECT_TABLES(Nft, Nft::Tables)
   // clang-format on
}  // namespace UserService
