#pragma once

#include <compare>
#include <psibase/actor.hpp>
#include <psibase/table.hpp>
#include <string_view>

#include "nft_sys.hpp"

namespace tokens_sys
{
   using tid = uint32_t;

   struct token_row
   {
      nft_sys::nid nft_id;
      uint32_t     key;
      bool         authorize;
      bool         recall;
      uint64_t     daily_inf_per_limit;
      uint64_t     yearly_inf_per_limit;
      uint64_t     allowed_daily_inflation;
      int64_t      avg_daily_inflation;
      int64_t      avg_yearly_inflation;

      eosio::time_point_sec last_update;

      uint64_t primary_key() const { return key; }
   };
   EOSIO_REFLECT(token_row,
                 nft_id,
                 key,
                 authorize,
                 recall,
                 daily_inf_per_limit,
                 yearly_inf_per_limit,
                 allowed_daily_inflation,
                 avg_daily_inflation,
                 avg_yearly_inflation,
                 last_update);
   PSIO_REFLECT(token_row,
                nft_id,
                key,
                authorize,
                recall,
                daily_inf_per_limit,
                yearly_inf_per_limit,
                allowed_daily_inflation,
                avg_daily_inflation,
                avg_yearly_inflation,
                last_update);

   using token_table_t = psibase::table<token_row, &token_row::nft_id>;

   using tables = psibase::contract_tables<token_table_t>;
   class tokens_contract : public psibase::contract
   {
     public:
      static constexpr psibase::account_num contract     = 104;
      static constexpr std::string_view     account_name = "tokens_sys";

      // This action allows the storage_payer account to create an account owner with zero token balance at the expense of ram_payer for specified token ID
      void open(psibase::account_num account, tid token_id, psibase::account_num storage_payer);
      void close(psibase::account_num account, tid token_id);

      // Transfers directly from uid to uid (no notification)
      void credit(psibase::account_num from,
                  psibase::account_num to,
                  int64_t              amount,
                  tid                  token_id,
                  const std::string&   memo);
      void debit(psibase::account_num actor_uid,
                 psibase::account_num from_uid,
                 psibase::account_num to_uid,
                 int64_t&             amount,
                 tid                  token_id,
                 const std::string&   memo);
      void approve(psibase::account_num owner,
                   psibase::account_num spender,
                   int64_t              amount,
                   tid                  token_id);

      void create(psibase::account_num issuer, uint8_t precision, int64_t max_supply);

     private:
      tables db{contract};
   };

   // clang-format off
   PSIO_REFLECT_INTERFACE(tokens_contract, 
      (open, 0, account, token_id, storage_payer)
   );
   // clang-format on

}  // namespace tokens_sys