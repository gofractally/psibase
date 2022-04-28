#pragma once

#include <compare>
#include <limits>
#include <psibase/Bitset.hpp>
#include <psibase/table.hpp>

#include "nft_sys.hpp"
#include "types.hpp"

namespace UserContract
{
   struct InfSettingsRecord
   {
      uint64_t daily_limit_pct;
      uint64_t daily_limit_qty;
      uint64_t yearly_limit_pct;

      friend std::strong_ordering operator<=>(const InfSettingsRecord&,
                                              const InfSettingsRecord&) = default;
   };
   PSIO_REFLECT(InfSettingsRecord, daily_limit_pct, daily_limit_qty, yearly_limit_pct);

   struct InfStatsRecord
   {
      int64_t avg_daily;
      int64_t avg_yearly;

      friend std::strong_ordering operator<=>(const InfStatsRecord&,
                                              const InfStatsRecord&) = default;
   };
   PSIO_REFLECT(InfStatsRecord, avg_daily, avg_yearly);

   struct InflationRecord
   {
      InfSettingsRecord settings;
      InfStatsRecord    stats;

      friend std::strong_ordering operator<=>(const InflationRecord&,
                                              const InflationRecord&) = default;
   };
   PSIO_REFLECT(InflationRecord, settings, stats);

   struct Flags
   {
      psibase::Bitset bits;

      enum FlagType
      {
         unrecallable = 0,
         // ... space for 15 more
         invalid = 16
      };

      bool get(FlagType flag) { return bits.get((size_t)flag); }
      void set(FlagType flag, bool value = true) { bits.set((size_t)flag, value); }

      friend std::strong_ordering operator<=>(const Flags&, const Flags&) = default;
   };
   PSIO_REFLECT(Flags, bits);

   struct TokenRecord
   {
      TID             id;
      NID             ownerNft;
      InflationRecord inflation;
      Flags           flags;
      Precision       precision;
      Quantity        currentSupply;
      Quantity        maxSupply;

      static bool isValidKey(TID tokenId)
      {
         return tokenId > 0 && tokenId <= std::numeric_limits<uint32_t>::max() / 2;
      }

      friend std::strong_ordering operator<=>(const TokenRecord&, const TokenRecord&) = default;
   };
   PSIO_REFLECT(TokenRecord, id, ownerNft, inflation, flags, precision, currentSupply, maxSupply);
   using TokenTable_t = psibase::table<TokenRecord, &TokenRecord::id>;

   struct BalanceRecord
   {
      psibase::AccountNumber account;
      TID                    tokenId;
      uint64_t               balance;

      friend std::strong_ordering operator<=>(const BalanceRecord&, const BalanceRecord&) = default;
   };
   PSIO_REFLECT(BalanceRecord, account, tokenId, balance);
   using BalanceTable_t = psibase::table<BalanceRecord, &BalanceRecord::account>;
   // Todo - additional index when available on tokenId

   struct SharedBalanceRecord
   {
      psibase::AccountNumber creditor;
      psibase::AccountNumber debitor;

      TID      tokenId;
      uint64_t balance;

      friend std::strong_ordering operator<=>(const SharedBalanceRecord&,
                                              const SharedBalanceRecord&) = default;
   };
   PSIO_REFLECT(SharedBalanceRecord, creditor, debitor, tokenId, balance);
   using SharedBalanceTable_t = psibase::table<SharedBalanceRecord, &SharedBalanceRecord::creditor>;
   // Todo - additional indices when available

}  // namespace UserContract