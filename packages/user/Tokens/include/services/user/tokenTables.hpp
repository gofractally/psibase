#pragma once

#include <compare>
#include <limits>
#include <psibase/MethodNumber.hpp>
#include <psibase/Table.hpp>
#include <services/user/tokenTypes.hpp>

#include "services/user/Nft.hpp"

namespace UserService
{
   struct TokenRecord
   {
      TID       id;
      NID       nft_id;
      uint8_t   settings_value;
      Precision precision;
      Quantity  issued_supply;
      Quantity  burned_supply;
      Quantity  max_issued_supply;

      auto operator<=>(const TokenRecord&) const = default;
   };
   PSIO_REFLECT(TokenRecord,
                id,
                nft_id,
                settings_value,
                precision,
                issued_supply,
                burned_supply,
                max_issued_supply);
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
