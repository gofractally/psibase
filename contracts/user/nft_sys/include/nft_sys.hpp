#pragma once

#include <psibase/actor.hpp>
#include <psibase/contract.hpp>
#include "errors.hpp"
#include "tables.hpp"

namespace UserContract
{
   using tables = psibase::contract_tables<NftTable_t, AdTable_t>;
   class NftSys : public psibase::contract
   {
     public:
      static constexpr psibase::AccountNumber contract = "nft-sys"_a;

      NID  mint();
      void burn(NID nftId);
      void autodebit(bool autodebit);
      void credit(psibase::AccountNumber receiver, NID nftId, std::string memo);
      void uncredit(NID nftId);
      void debit(NID nftId);

      // Read-only:
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
