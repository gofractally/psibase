#pragma once

#include <compare>
#include <psibase/actor.hpp>
#include <psibase/table.hpp>
#include <string_view>

namespace nft_sys
{
   namespace errors
   {
      std::string_view nftDNE                 = "NFT does not exist";
      std::string_view debitRequiresCredit    = "NFT can only be debited after being credited";
      std::string_view uncreditRequiresCredit = "NFT can only be uncredited after being credited";
      std::string_view creditorIsDebitor      = "Creditor and debitor cannot be the same account";
      std::string_view creditorAction         = "Only the creditor may perform this action";

      // Todo: Move to somewhere common
      std::string_view missingRequiredAuth = "Missing required authority";

   }  // namespace errors

   using nid = uint64_t;  //TODO: change to 32 bit

   struct AdRow
   {
      psibase::AccountNumber user;
      bool                   autodebit;
   };
   EOSIO_REFLECT(AdRow, user, autodebit);
   PSIO_REFLECT(AdRow, user, autodebit);

   using ad_table_t = psibase::table<AdRow, &AdRow::user>;
   struct nft_row
   {
      nid                    id;
      psibase::AccountNumber issuer;
      psibase::AccountNumber owner;
      psibase::AccountNumber approved_account;

      static bool is_valid_key(const nid& id) { return id != 0; }

      struct DiskUsage
      {
         static constexpr int64_t firstEmplace      = 100;
         static constexpr int64_t subsequentEmplace = 100;
         static constexpr int64_t update            = 100;
      };

      friend std::strong_ordering operator<=>(const nft_row&, const nft_row&) = default;
   };
   EOSIO_REFLECT(nft_row, id, issuer, owner, approved_account);
   PSIO_REFLECT(nft_row, id, issuer, owner, approved_account);

   using nft_table_t = psibase::table<nft_row, &nft_row::id>;

   using tables = psibase::contract_tables<nft_table_t, ad_table_t>;
   class nft_contract : public psibase::contract
   {
     public:
      static constexpr psibase::AccountNumber contract = "nft-sys"_a;

      using sub_id_type = uint32_t;

      // Create a new NFT in issuer's scope, with sub_id 0
      nid  mint(psibase::AccountNumber issuer);
      void burn(psibase::AccountNumber owner, nid nftId){};

      void autodebit(psibase::AccountNumber account, bool autoDebit) {}

      void credit(psibase::AccountNumber sender,
                  psibase::AccountNumber receiver,
                  nid                    nftId,
                  std::string            memo)
      {
      }
      void uncredit(psibase::AccountNumber sender, psibase::AccountNumber receiver, nid nftId) {}
      void debit(psibase::AccountNumber sender, psibase::AccountNumber receiver, nid nftId) {}

      void approve(nid nftId, psibase::AccountNumber account) {}
      void unapprove(nid nftId, psibase::AccountNumber account) {}

      // Read-only interface
      std::optional<nft_row> getNft(nid nftId);
      int64_t                isAutodebit(psibase::AccountNumber user);

     private:
      tables db{contract};
   };

   // clang-format off
   PSIO_REFLECT_INTERFACE(nft_contract, 
      (mint, 0, issuer), 
      (burn, 1, owner, nftId),

      (autodebit, 2, account, autoDebit),

      (credit, 3, sender, receiver, nftId, memo),
      (uncredit, 4, sender, receiver, nftId),
      (debit, 5, sender, receiver, nftId),
      
      (approve, 6, nftId, account),
      (unapprove, 7, nftId, account),
      
      (getNft, 8, nftId),
      (isAutodebit, 9, user)
   );
   // clang-format on

}  // namespace nft_sys
