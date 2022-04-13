#pragma once

#include <psibase/actor.hpp>
#include <psibase/contract.hpp>
#include <string_view>

#include "tables.hpp"

namespace UserContract
{
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
   PSIO_REFLECT(NftSys, 
      method(mint), 
      method(burn, nftId),

      method(autodebit, autodebit),

      method(credit, receiver, nftId, memo),
      method(uncredit, nftId),
      method(debit, nftId),
      
      method(getNft, nftId),
      method(isAutodebit)
   );
   // clang-format on

}  // namespace UserContract
