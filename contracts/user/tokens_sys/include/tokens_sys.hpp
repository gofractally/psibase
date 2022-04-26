#pragma once

#include <compare>
#include <psibase/Contract.hpp>
#include <psibase/table.hpp>
#include <psibase/time.hpp>
#include <string_view>

#include "nft_sys.hpp"

namespace tokens_sys
{
   using tid = uint32_t;

   struct token_row
   {
      UserContract::NID nft_id;
      uint32_t          key;
      bool              authorize;
      bool              recall;
      uint64_t          daily_inf_per_limit;
      uint64_t          yearly_inf_per_limit;
      uint64_t          allowed_daily_inflation;
      int64_t           avg_daily_inflation;
      int64_t           avg_yearly_inflation;

      psibase::TimePointSec last_update;

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
   class tokens_contract : public psibase::Contract<tokens_contract>
   {
     public:
      static constexpr psibase::AccountNumber contract = "tokens-sys"_a;

      // This action allows the storage_payer account to create an account owner with zero token balance at the expense of ram_payer for specified token ID
      void open(psibase::AccountNumber account, tid token_id, psibase::AccountNumber storage_payer);
      void close(psibase::AccountNumber account, tid token_id);

      // Transfers directly from uid to uid (no notification)
      void credit(psibase::AccountNumber from,
                  psibase::AccountNumber to,
                  int64_t                amount,
                  tid                    token_id,
                  const std::string&     memo);
      void debit(psibase::AccountNumber actor_uid,
                 psibase::AccountNumber from_uid,
                 psibase::AccountNumber to_uid,
                 int64_t&               amount,
                 tid                    token_id,
                 const std::string&     memo);
      void approve(psibase::AccountNumber owner,
                   psibase::AccountNumber spender,
                   int64_t                amount,
                   tid                    token_id);

      void create(psibase::AccountNumber issuer, uint8_t precision, int64_t max_supply);

     private:
      tables db{contract};
   };

   PSIO_REFLECT(  //
       tokens_contract,
       method(open, account, token_id, storage_payer));

}  // namespace tokens_sys
