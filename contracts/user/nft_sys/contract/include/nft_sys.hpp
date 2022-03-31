#pragma once

#include <compare>
#include <psibase/actor.hpp>
#include <psibase/table.hpp>
#include <string_view>

namespace nft_sys
{
   using nid = uint64_t;
   struct nft_row
   {
      nid                  nftid;
      psibase::account_num issuer;
      psibase::account_num owner;
      psibase::account_num approved_account;

      static bool is_valid_key(const nid& id) { return id != 0; }

      struct DiskUsage
      {
         static constexpr int64_t firstEmplace      = 100;
         static constexpr int64_t subsequentEmplace = 100;
      };

      friend std::strong_ordering operator<=>(const nft_row&, const nft_row&) = default;
   };
   EOSIO_REFLECT(nft_row, nftid, issuer, owner, approved_account);
   PSIO_REFLECT(nft_row, nftid, issuer, owner, approved_account);

   using nft_table_t = psibase::table<nft_row, &nft_row::nftid>;

   using tables = psibase::contract_tables<nft_table_t>;
   class nft_contract : public psibase::contract
   {
     public:
      static constexpr psibase::account_num contract     = 100;
      static constexpr std::string_view     account_name = "nft_sys";

      using sub_id_type = uint32_t;

      // Create a new NFT in issuer's scope, with sub_id 0
      nid  mint(psibase::account_num issuer, sub_id_type sub_id);
      void credit(psibase::account_num sender,
                  psibase::account_num receiver,
                  nid                  nftId,
                  std::string          memo)
      {
      }
      void uncredit(psibase::account_num sender, nid nftId) {}
      void debit(psibase::account_num sender, psibase::account_num receiver, nid nftId) {}
      void burn(nid nftId) {}
      void approve(nid nftId, psibase::account_num account) {}
      void unapprove(nid nftId, psibase::account_num account) {}
      void autodebit(psibase::account_num account, bool autoDebit) {}

      // Read-only interface
      std::optional<nft_row> getNft(nid nft_id);
      std::optional<nft_row> getNft2(psibase::account_num issuer, sub_id_type sub_id) {}

     private:
      tables db{contract};
   };

   // clang-format off
   PSIO_REFLECT_INTERFACE(nft_contract, 
      (mint, 0, issuer, sub_id), 
      (credit, 1, sender, receiver, nftId, memo),
      (uncredit, 2, sender, nftId),
      (debit, 3, sender, receiver, nftId),
      (burn, 4, nftId),
      (approve, 5, nftId, account),
      (unapprove, 6, nftId, account),
      (autodebit, 7, account, autoDebit),
      (getNft, 8, nft_id),
      (getNft2, 9, issuer, sub_id)
   );
   // clang-format on

}  // namespace nft_sys