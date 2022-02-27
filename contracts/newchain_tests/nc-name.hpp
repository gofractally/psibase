#pragma once

#include <newchain/intrinsic.hpp>

#include <eosio/asset.hpp>
#include <eosio/from_bin.hpp>
#include <eosio/to_bin.hpp>

namespace name
{
   static constexpr newchain::account_num contract = 2;

   struct register_account
   {
      using return_type = void;

      newchain::account_num account = {};
      std::string           name    = {};
   };
   EOSIO_REFLECT(register_account, account, name)

   struct create_account
   {
      using return_type = newchain::account_num;

      std::string name          = {};
      std::string auth_contract = {};
      bool        privileged    = {};
   };
   EOSIO_REFLECT(create_account, name, auth_contract, privileged)

   struct get_by_name
   {
      using return_type = std::optional<newchain::account_num>;

      std::string name = {};
   };
   EOSIO_REFLECT(get_by_name, name)

   struct get_by_num
   {
      using return_type = std::optional<std::string>;

      newchain::account_num num = {};
   };
   EOSIO_REFLECT(get_by_num, num)

   using action = std::variant<register_account, create_account, get_by_name, get_by_num>;

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
}  // namespace name
