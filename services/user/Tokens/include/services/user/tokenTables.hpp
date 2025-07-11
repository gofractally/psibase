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
