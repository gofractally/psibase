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
   struct TokensInitRecord
   {
      TID           last_used_id;
      std::uint64_t last_used_shared_bal_id;
      std::uint64_t last_used_subaccount_id;
   };
   PSIO_REFLECT(TokensInitRecord, last_used_id, last_used_shared_bal_id, last_used_subaccount_id)
   using TokensInitTable = psibase::Table<TokensInitRecord, psibase::SingletonKey{}>;
   PSIO_REFLECT_TYPENAME(TokensInitTable)

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

}  // namespace UserService
