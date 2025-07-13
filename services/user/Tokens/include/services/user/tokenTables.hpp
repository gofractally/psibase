#pragma once

#include <compare>
#include <limits>
#include <psibase/MethodNumber.hpp>
#include <psibase/Table.hpp>
#include <services/user/tokenTypes.hpp>

#include "services/user/Nft.hpp"
#include "services/user/symbolTables.hpp"

namespace UserService
{
   struct TokenRecord
   {
      TID                id;
      NID                nft_id;
      uint8_t            settings_value;
      uint8_t            precision;
      Quantity           issued_supply;
      Quantity           burned_supply;
      Quantity           max_issued_supply;
      std::optional<SID> symbol;

      static bool isValidKey(TID tokenId)
      {
         /*
          * The final of the 32 bits is reserved such that there are only 31 bits used for token ID.
          * This is simply an attempt to future proof the token record, so we have a spare bit to
          *   separately namespace tokens should the need arise.
          */

         return tokenId > 0 && tokenId <= std::numeric_limits<uint32_t>::max() / 2;
      }

      auto operator<=>(const TokenRecord&) const = default;
   };
   PSIO_REFLECT(TokenRecord,
                id,
                nft_id,
                settings_value,
                precision,
                issued_supply,
                burned_supply,
                max_issued_supply,
                symbol);
   using TokenTable = psibase::Table<TokenRecord, &TokenRecord::id>;
   PSIO_REFLECT_TYPENAME(TokenTable)

   struct TokenHolderRecord
   {
      psibase::AccountNumber account;
      psibase::Bitset<8>     config;

      using Configurations = psibase::Enum<psibase::EnumElement{"manualDebit"}>;

      auto operator<=>(const TokenHolderRecord&) const = default;
   };
   PSIO_REFLECT(TokenHolderRecord, account, config);
   using TokenHolderTable = psibase::Table<TokenHolderRecord, &TokenHolderRecord::account>;
   PSIO_REFLECT_TYPENAME(TokenHolderTable)

}  // namespace UserService
