#pragma once

#include <psibase/Contract.hpp>
#include "errors.hpp"
#include "tables.hpp"

namespace UserContract
{
   class NftSys : public psibase::Contract<NftSys>
   {
     public:
      using tables = psibase::contract_tables<NftTable_t, AdTable_t>;
      static constexpr auto contract = psibase::AccountNumber("nft-sys");

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
      bool _exists(NID nftId);
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
