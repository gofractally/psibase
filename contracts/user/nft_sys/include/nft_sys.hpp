#pragma once

#include <compare>
#include <psibase/actor.hpp>
#include <psibase/table.hpp>
#include <string_view>

namespace UserContract
{
   namespace Errors
   {
      std::string_view nftDNE                 = "NFT does not exist";
      std::string_view debitRequiresCredit    = "NFT can only be debited after being credited";
      std::string_view uncreditRequiresCredit = "NFT can only be uncredited after being credited";
      std::string_view creditorIsDebitor      = "Creditor and debitor cannot be the same account";
      std::string_view creditorAction         = "Only the creditor may perform this action";

      // Todo: Move to somewhere common
      std::string_view missingRequiredAuth = "Missing required authority";

   }  // namespace Errors

   using NID = uint64_t;  //TODO: change to 32 bit

   struct AdRow
   {
      psibase::AccountNumber user;
      bool                   autodebit;
   };
   EOSIO_REFLECT(AdRow, user, autodebit);
   PSIO_REFLECT(AdRow, user, autodebit);

   using AdTable_t = psibase::table<AdRow, &AdRow::user>;
   struct NftRow
   {
      NID                    id;
      psibase::AccountNumber issuer;
      psibase::AccountNumber owner;
      psibase::AccountNumber approvedAccount;

      static bool isValidKey(const NID& id) { return id != 0; }

      struct DiskUsage
      {
         static constexpr int64_t firstEmplace      = 100;
         static constexpr int64_t subsequentEmplace = 100;
         static constexpr int64_t update            = 100;
      };

      friend std::strong_ordering operator<=>(const NftRow&, const NftRow&) = default;
   };
   EOSIO_REFLECT(NftRow, id, issuer, owner, approvedAccount);
   PSIO_REFLECT(NftRow, id, issuer, owner, approvedAccount);

   using nft_table_t = psibase::table<NftRow, &NftRow::id>;

   using tables = psibase::contract_tables<nft_table_t, AdTable_t>;
   class NftSys : public psibase::contract
   {
     public:
      static constexpr psibase::AccountNumber contract = "nft-sys"_a;

      using sub_id_type = uint32_t;

      // Create a new NFT in issuer's scope, with sub_id 0
      NID  mint();
      void burn(NID nftId){};

      void autodebit(bool autoDebit);

      void credit(psibase::AccountNumber receiver, NID nftId, std::string memo) {}
      void uncredit(psibase::AccountNumber receiver, NID nftId) {}
      void debit(psibase::AccountNumber sender, NID nftId) {}

      void approve(NID nftId, psibase::AccountNumber account) {}
      void unapprove(NID nftId, psibase::AccountNumber account) {}

      // Read-only interface
      std::optional<NftRow> getNft(NID nftId);
      int64_t               isAutodebit();

     private:
      tables db{contract};
   };

   // clang-format off
   PSIO_REFLECT_INTERFACE(NftSys, 
      (mint, 0), 
      (burn, 1, nftId),

      (autodebit, 2, autoDebit),

      (credit, 3, receiver, nftId, memo),
      (uncredit, 4, receiver, nftId),
      (debit, 5, sender, nftId),
      
      (approve, 6, nftId, account),
      (unapprove, 7, nftId, account),
      
      (getNft, 8, nftId),
      (isAutodebit, 9)
   );
   // clang-format on

}  // namespace UserContract
