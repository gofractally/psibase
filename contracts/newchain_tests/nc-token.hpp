#pragma once

#include <newchain/intrinsic.hpp>

#include <eosio/asset.hpp>
#include <eosio/from_bin.hpp>
#include <eosio/to_bin.hpp>

namespace token
{
   static constexpr newchain::account_num contract = 3;

   struct issue
   {
      using return_type = void;

      newchain::account_num to     = {};
      eosio::asset          amount = {};
      std::string           memo   = {};
   };
   EOSIO_REFLECT(issue, to, amount, memo)

   struct transfer
   {
      using return_type = void;

      newchain::account_num to     = {};
      eosio::asset          amount = {};
      std::string           memo   = {};
   };
   EOSIO_REFLECT(transfer, to, amount, memo)

   using action = std::variant<issue, transfer>;

   template <typename T, typename R = typename T::return_type>
   R call(newchain::account_num sender, T args)
   {
      auto result = newchain::call(newchain::action{
          .sender   = sender,
          .contract = contract,
          .raw_data = eosio::convert_to_bin(action{std::move(args)}),
      });
      if constexpr (!std::is_same_v<R, void>)
         return eosio::convert_from_bin<R>(result);
   }
}  // namespace token
