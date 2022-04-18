#pragma once

#include <compare>
#include <psibase/table.hpp>

#include "nft_sys.hpp"

namespace UserContract
{
   using TID = uint32_t;

   struct TokenRecord
   {
      TID tokenId;
      NID ownerNft;

      bool     recall;
      uint64_t daily_inf_per_limit;
      uint64_t yearly_inf_per_limit;
      uint64_t allowed_daily_inflation;
      int64_t  avg_daily_inflation;
      int64_t  avg_yearly_inflation;

      struct DiskUsage
      {
         static constexpr int64_t firstEmplace      = 100;
         static constexpr int64_t subsequentEmplace = 100;
         static constexpr int64_t update            = 100;
      };

      friend std::strong_ordering operator<=>(const TokenRecord&, const TokenRecord&) = default;
   };
   EOSIO_REFLECT(TokenRecord,
                 tokenId,
                 ownerNft,
                 recall,
                 daily_inf_per_limit,
                 yearly_inf_per_limit,
                 allowed_daily_inflation,
                 avg_daily_inflation,
                 avg_yearly_inflation);
   PSIO_REFLECT(TokenRecord,
                tokenId,
                ownerNft,
                recall,
                daily_inf_per_limit,
                yearly_inf_per_limit,
                allowed_daily_inflation,
                avg_daily_inflation,
                avg_yearly_inflation);

   using TokenTable_t = psibase::table<TokenRecord, &TokenRecord::tokenId>;
}  // namespace UserContract