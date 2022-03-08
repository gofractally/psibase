#pragma once

#include <psibase/intrinsic.hpp>
#include <psibase/native_tables.hpp>

namespace nft_sys
{
   static constexpr psibase::account_num contract = 100;

   struct mint
   {
      using return_type = uint64_t;
      using sub_id_type = uint32_t;

      psibase::account_num issuer;
      sub_id_type          sub_id;
   };
   EOSIO_REFLECT(mint, issuer, sub_id)

   using action = std::variant<mint>;

   template <typename T, typename R = typename T::return_type>
   R call(psibase::account_num sender, T args)
   {
      auto result = psibase::call(psibase::action{
          .sender   = sender,
          .contract = contract,
          .raw_data = eosio::convert_to_bin(action{std::move(args)}),
      });
      if constexpr (!std::is_same_v<R, void>)
         return eosio::convert_from_bin<R>(result);
   }
}  // namespace nft_sys