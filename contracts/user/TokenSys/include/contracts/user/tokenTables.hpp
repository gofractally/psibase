#pragma once

#include <compare>
#include <contracts/user/tokenTypes.hpp>
#include <limits>
#include <psibase/MethodNumber.hpp>
#include <psibase/Table.hpp>

#include "contracts/user/NftSys.hpp"
#include "contracts/user/symbolTables.hpp"

namespace UserContract
{
   struct InfSettingsRecord
   {
      uint64_t daily_limit_pct;
      uint64_t daily_limit_qty;
      uint64_t yearly_limit_pct;

      auto operator<=>(const InfSettingsRecord&) const = default;
   };
   PSIO_REFLECT(InfSettingsRecord, daily_limit_pct, daily_limit_qty, yearly_limit_pct);

   struct InfStatsRecord
   {
      int64_t avg_daily;
      int64_t avg_yearly;

      auto operator<=>(const InfStatsRecord&) const = default;
   };
   PSIO_REFLECT(InfStatsRecord, avg_daily, avg_yearly);

   struct InflationRecord
   {
      InfSettingsRecord settings;
      InfStatsRecord    stats;

      auto operator<=>(const InflationRecord&) const = default;
   };
   PSIO_REFLECT(InflationRecord, settings, stats);

   struct TokenRecord
   {
      TID                id;
      NID                ownerNft;
      InflationRecord    inflation;
      psibase::Bitset<8> config;
      Precision          precision;
      Quantity           currentSupply;
      Quantity           maxSupply;
      SID                symbolId;

      using Configurations =
          psibase::NamedBits<psibase::NamedBit{"unrecallable"}, psibase::NamedBit{"untradeable"}>;

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
                ownerNft,
                inflation,
                config,
                precision,
                currentSupply,
                maxSupply,
                symbolId);
   using TokenTable = psibase::Table<TokenRecord, &TokenRecord::id>;
   // Todo - add symbolId as secondary index when possible

   struct BalanceKey
   {
      psibase::AccountNumber account;
      TID                    tokenId;

      auto operator<=>(const BalanceKey&) const = default;
   };
   PSIO_REFLECT(BalanceKey, account, tokenId);

   struct BalanceRecord
   {
      BalanceKey key;
      uint64_t   balance;

      auto operator<=>(const BalanceRecord&) const = default;
   };
   PSIO_REFLECT(BalanceRecord, key, balance);
   using BalanceTable = psibase::Table<BalanceRecord, &BalanceRecord::key>;

   struct SharedBalanceKey
   {
      psibase::AccountNumber creditor;
      psibase::AccountNumber debitor;
      TID                    tokenId;

      auto operator<=>(const SharedBalanceKey&) const = default;
   };
   PSIO_REFLECT(SharedBalanceKey, creditor, debitor, tokenId);

   struct SharedBalanceRecord
   {
      SharedBalanceKey key;
      uint64_t         balance;

      auto operator<=>(const SharedBalanceRecord&) const = default;
   };
   PSIO_REFLECT(SharedBalanceRecord, key, balance);
   using SharedBalanceTable = psibase::Table<SharedBalanceRecord, &SharedBalanceRecord::key>;
   // Todo - How can I add a secondary index for debitor? I imagine people will want to search for shared balances by debitor.

   struct TokenHolderRecord
   {
      psibase::AccountNumber account;
      psibase::Bitset<8>     config;

      using Configurations = psibase::NamedBits<psibase::NamedBit{"manualDebit"}>;

      auto operator<=>(const TokenHolderRecord&) const = default;
   };
   PSIO_REFLECT(TokenHolderRecord, account, config);
   using TokenHolderTable = psibase::Table<TokenHolderRecord, &TokenHolderRecord::account>;

}  // namespace UserContract