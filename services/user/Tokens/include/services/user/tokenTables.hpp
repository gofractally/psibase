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
   struct InfSettingsRecord
   {
      uint64_t dailyLimitPct;
      uint64_t dailyLimitQty;
      uint64_t yearlyLimitPct;

      auto operator<=>(const InfSettingsRecord&) const = default;
   };
   PSIO_REFLECT(InfSettingsRecord, dailyLimitPct, dailyLimitQty, yearlyLimitPct);

   struct InfStatsRecord
   {
      int64_t avgDaily;
      int64_t avgYearly;

      auto operator<=>(const InfStatsRecord&) const = default;
   };
   PSIO_REFLECT(InfStatsRecord, avgDaily, avgYearly);

   struct InflationRecord
   {
      InfSettingsRecord settings;
      InfStatsRecord    stats;

      auto operator<=>(const InflationRecord&) const = default;
   };
   PSIO_REFLECT(InflationRecord, settings, stats);

   struct TokenRecord
   {
      TID             id;
      NID             ownerNft;
      InflationRecord inflation;
      uint8_t         config;
      Precision       precision;
      Quantity        currentSupply;
      Quantity        maxSupply;
      SID             symbolId;

      using Configurations =
          psibase::Enum<psibase::EnumElement{"unrecallable"}, psibase::EnumElement{"untradeable"}>;

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
   PSIO_REFLECT_TYPENAME(TokenTable)

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
   PSIO_REFLECT_TYPENAME(BalanceTable)

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

      using ByDebitor = psibase::NestedKey<&SharedBalanceRecord::key,
                                           psibase::CompositeKey<&SharedBalanceKey::debitor,
                                                                 &SharedBalanceKey::creditor,
                                                                 &SharedBalanceKey::tokenId>{}>;

      auto operator<=>(const SharedBalanceRecord&) const = default;
   };
   PSIO_REFLECT(SharedBalanceRecord, key, balance);
   using SharedBalanceTable = psibase::
       Table<SharedBalanceRecord, &SharedBalanceRecord::key, SharedBalanceRecord::ByDebitor{}>;
   PSIO_REFLECT_TYPENAME(SharedBalanceTable)

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
