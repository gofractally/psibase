#pragma once

#include <compare>
#include <limits>
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

   struct TokenRecord
   {
      TID             id;
      NID             ownerNft;
      InflationRecord inflation;
      psibase::Bitset flags;
      Precision       precision;
      Quantity        currentSupply;
      Quantity        maxSupply;

      static bool isValidKey(TID tokenId)
      {
         /*
          * The final of the 32 bits is reserved such that there are only 31 bits used for token ID.
          * This is simply an attempt to future proof the token record, so we have a spare bit to
          *   separately namespace tokens should the need arise.
          */

         return tokenId > 0 && tokenId <= std::numeric_limits<uint32_t>::max() / 2;
      }

      enum Flags : uint8_t
      {
         unrecallable
      };

      friend std::strong_ordering operator<=>(const TokenRecord&, const TokenRecord&) = default;
   };
   PSIO_REFLECT(TokenRecord, id, ownerNft, inflation, flags, precision, currentSupply, maxSupply);
   using TokenTable_t = psibase::table<TokenRecord, &TokenRecord::id>;

   struct BalanceKey_t
   {
      TID                    tokenId;
      psibase::AccountNumber account;

      friend std::strong_ordering operator<=>(const BalanceKey_t&, const BalanceKey_t&) = default;
   };
   PSIO_REFLECT(BalanceKey_t, tokenId, account);

   struct BalanceRecord
   {
      BalanceKey_t key;
      uint64_t     balance;

      operator uint64_t() const { return balance; }
      operator Quantity() const { return Quantity{balance}; }

      friend std::strong_ordering operator<=>(const BalanceRecord&, const BalanceRecord&) = default;
   };
   PSIO_REFLECT(BalanceRecord, key, balance);
   using BalanceTable_t = psibase::table<BalanceRecord, &BalanceRecord::key>;

   struct SharedBalanceKey_t
   {
      TID                    tokenId;
      psibase::AccountNumber creditor;
      psibase::AccountNumber debitor;

      friend std::strong_ordering operator<=>(const SharedBalanceKey_t&,
                                              const SharedBalanceKey_t&) = default;
   };
   PSIO_REFLECT(SharedBalanceKey_t, tokenId, creditor, debitor);
   struct SharedBalanceRecord
   {
      SharedBalanceKey_t key;
      uint64_t           balance;

      operator uint64_t() const { return balance; }
      operator Quantity() const { return Quantity{balance}; }

      friend std::strong_ordering operator<=>(const SharedBalanceRecord&,
                                              const SharedBalanceRecord&) = default;
   };
   PSIO_REFLECT(SharedBalanceRecord, key, balance);
   using SharedBalanceTable_t = psibase::table<SharedBalanceRecord, &SharedBalanceRecord::key>;

   struct TokenHolderRecord
   {
      psibase::AccountNumber account;
      psibase::Bitset        config;

      operator psibase::AccountNumber() const { return account; }

      enum Flags : uint8_t
      {
         manualDebit
      };

      friend std::strong_ordering operator<=>(const TokenHolderRecord&,
                                              const TokenHolderRecord&) = default;
   };
   PSIO_REFLECT(TokenHolderRecord, account, config);
   using TokenHolderTable_t = psibase::table<TokenHolderRecord, &TokenHolderRecord::account>;

}  // namespace UserContract