#pragma once

#include <compare>
#include <psibase/Bitset.hpp>
#include <psibase/table.hpp>

#include "nft_sys.hpp"

namespace UserContract
{
   using TID = uint32_t;

   struct InfSettingsRecord
   {
      uint64_t daily_limit_pct;
      uint64_t daily_limit_qty;
      uint64_t yearly_limit_pct;

      friend std::strong_ordering operator<=>(const InfSettingsRecord&,
                                              const InfSettingsRecord&) = default;
   };
   EOSIO_REFLECT(InfSettingsRecord, daily_limit_pct, daily_limit_qty, yearly_limit_pct);
   PSIO_REFLECT(InfSettingsRecord, daily_limit_pct, daily_limit_qty, yearly_limit_pct);

   struct InfStatsRecord
   {
      int64_t avg_daily;
      int64_t avg_yearly;

      friend std::strong_ordering operator<=>(const InfStatsRecord&,
                                              const InfStatsRecord&) = default;
   };
   EOSIO_REFLECT(InfStatsRecord, avg_daily, avg_yearly);
   PSIO_REFLECT(InfStatsRecord, avg_daily, avg_yearly);

   struct InflationRecord
   {
      InfSettingsRecord settings;
      InfStatsRecord    stats;

      friend std::strong_ordering operator<=>(const InflationRecord&,
                                              const InflationRecord&) = default;
   };
   EOSIO_REFLECT(InflationRecord, settings, stats);
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
   EOSIO_REFLECT(Flags, bits);
   PSIO_REFLECT(Flags, bits);

   struct TokenRecord
   {
      TID             tokenId;
      NID             ownerNft;
      InflationRecord inflation;
      Flags           flags;

      friend std::strong_ordering operator<=>(const TokenRecord&, const TokenRecord&) = default;
   };
   EOSIO_REFLECT(TokenRecord, tokenId, ownerNft, inflation, flags);
   PSIO_REFLECT(TokenRecord, tokenId, ownerNft, inflation, flags);
   using TokenTable_t = psibase::table<TokenRecord, &TokenRecord::tokenId>;

   struct BalanceRecord
   {
      psibase::AccountNumber account;
      TID                    tokenId;
      uint64_t               balance;
   };
   EOSIO_REFLECT(BalanceRecord, account, tokenId, balance);
   PSIO_REFLECT(BalanceRecord, account, tokenId, balance);
   using BalanceTable_t = psibase::table<BalanceRecord, &BalanceRecord::account>;
   // Todo - additional index when available on tokenId

   struct SharedBalanceRecord
   {
      psibase::AccountNumber creditor;
      psibase::AccountNumber debitor;

      TID      tokenId;
      uint64_t balance;
   };
   EOSIO_REFLECT(SharedBalanceRecord, creditor, debitor, tokenId, balance);
   PSIO_REFLECT(SharedBalanceRecord, creditor, debitor, tokenId, balance);
   using SharedBalanceTable_t = psibase::table<SharedBalanceRecord, &SharedBalanceRecord::creditor>;
   // Todo - additional indices when available

}  // namespace UserContract