#pragma once

#include <eosio/crypto.hpp>
#include <psibase/intrinsic.hpp>
#include <psibase/native_tables.hpp>

namespace auth_ec_sys
{
   static constexpr psibase::account_num contract = 5;

   struct auth_check
   {
      psibase::action             action;
      std::vector<psibase::claim> claims;
   };
   EOSIO_REFLECT(auth_check, action, claims)

   struct set_key
   {
      psibase::account_num account;
      eosio::public_key    key;
   };
   EOSIO_REFLECT(set_key, account, key)

   // TODO: remove. This is just a temporary approach for creating an account with a key.
   struct create_account
   {
      using return_type = psibase::account_num;

      std::string       name       = {};
      eosio::public_key public_key = {};
      bool              allow_sudo = {};
   };
   EOSIO_REFLECT(create_account, name, public_key, allow_sudo)

   using action = std::variant<auth_check, set_key, create_account>;

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
}  // namespace auth_ec_sys
