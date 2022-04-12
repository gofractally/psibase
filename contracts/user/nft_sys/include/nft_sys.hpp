#pragma once

#include <compare>
#include <psibase/actor.hpp>
#include <psibase/table.hpp>
#include <string_view>

namespace UserContract
{
   // struct SharedRecord
   // {
   //    SharedAccount sa;
   //    uint64_t      id;

   //    static bool isValidKey(const uint64_t& id) { return id != 0; }

   //    struct DiskUsage
   //    {
   //       static constexpr int64_t firstEmplace      = 100;
   //       static constexpr int64_t subsequentEmplace = 100;
   //       static constexpr int64_t update            = 100;
   //    };

   //    friend std::strong_ordering operator<=>(const SharedRecord&, const SharedRecord&) = default;
   // };
   // EOSIO_REFLECT(SharedRecord, sa, id);
   // PSIO_REFLECT(SharedRecord, sa, id);

   // using SharedTable_t = psibase::table<SharedRecord, &SharedRecord::sa, &SharedRecord::id>;

   using NID = uint64_t;  //TODO: change to 32 bit
   struct AdRecord
   {
      psibase::AccountNumber user;
      bool                   autodebit;

      struct DiskUsage
      {
         static constexpr int64_t firstEmplace      = 100;
         static constexpr int64_t subsequentEmplace = 100;
         static constexpr int64_t update            = 100;
      };

      friend std::strong_ordering operator<=>(const AdRecord&, const AdRecord&) = default;
   };
   EOSIO_REFLECT(AdRecord, user, autodebit);
   PSIO_REFLECT(AdRecord, user, autodebit);

   using AdTable_t = psibase::table<AdRecord, &AdRecord::user>;
   struct NftRecord
   {
      NID                    id;
      psibase::AccountNumber issuer;
      psibase::AccountNumber owner;
      psibase::AccountNumber creditedTo;

      static bool isValidKey(const NID& id) { return id != 0; }

      struct DiskUsage
      {
         static constexpr int64_t firstEmplace      = 100;
         static constexpr int64_t subsequentEmplace = 100;
         static constexpr int64_t update            = 100;
      };

      friend std::strong_ordering operator<=>(const NftRecord&, const NftRecord&) = default;
   };
   EOSIO_REFLECT(NftRecord, id, issuer, owner, creditedTo);
   PSIO_REFLECT(NftRecord, id, issuer, owner, creditedTo);

   using NftTable_t = psibase::table<NftRecord, &NftRecord::id>;

   using tables = psibase::contract_tables<NftTable_t, AdTable_t>;
   class NftSys : public psibase::contract
   {
     public:
      static constexpr psibase::AccountNumber contract = "nft-sys"_a;

      struct Errors
      {
         static constexpr std::string_view nftDNE = "NFT does not exist";
         static constexpr std::string_view debitRequiresCredit =
             "NFT can only be debited after being credited";
         static constexpr std::string_view uncreditRequiresCredit =
             "NFT can only be uncredited after being credited";
         static constexpr std::string_view creditorIsDebitor =
             "Creditor and debitor cannot be the same account";
         static constexpr std::string_view creditorAction =
             "Only the creditor may perform this action";
         static constexpr std::string_view receiverDNE     = "Receiver DNE";
         static constexpr std::string_view alreadyCredited = "NFT already credited to an account";

         // Todo: Move to somewhere common
         static constexpr std::string_view missingRequiredAuth = "Missing required authority";
      };

      // Create a new NFT in issuer's scope, with sub_id 0
      NID  mint();
      void burn(NID nftId);

      void autodebit(bool autodebit);

      void credit(psibase::AccountNumber receiver, NID nftId, std::string memo);
      void uncredit(NID nftId);
      void debit(NID nftId);

      // Read-only interface
      std::optional<NftRecord> getNft(NID nftId);
      bool                     isAutodebit();

     private:
      tables db{contract};

      bool _isAutoDebit(psibase::AccountNumber account);
   };

   // clang-format off
   PSIO_REFLECT_INTERFACE(NftSys, 
      (mint, 0), 
      (burn, 1, nftId),

      (autodebit, 2, autodebit),

      (credit, 3, receiver, nftId, memo),
      (uncredit, 4, nftId),
      (debit, 5, nftId),
      
      (getNft, 6, nftId),
      (isAutodebit, 7)
   );
   // clang-format on

}  // namespace UserContract
