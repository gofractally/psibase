#pragma once

#include <psibase/intrinsic.hpp>
#include <psibase/native_tables.hpp>

namespace system_contract::auth_ec_sys
{
   static constexpr psibase::AccountNumber contract = psibase::AccountNumber("auth-ec-sys");

   struct auth_check
   {
      psibase::Action             action;
      std::vector<psibase::Claim> claims;
   };
   PSIO_REFLECT(auth_check, action, claims)

   struct set_key
   {
      psibase::AccountNumber account;
      psibase::PublicKey     key;
   };
   PSIO_REFLECT(set_key, account, key)

   // TODO: remove. This is just a temporary approach for creating an account with a key.
   struct create_account
   {
      using return_type = psibase::AccountNumber;

      psibase::AccountNumber name       = {};
      psibase::PublicKey     public_key = {};
   };
   PSIO_REFLECT(create_account, name, public_key)

   using action = std::variant<auth_check, set_key, create_account>;

#ifdef __wasm__
   template <typename T, typename R = typename T::return_type>
   R call(psibase::AccountNumber sender, T args)
   {
      auto result = psibase::call(psibase::Action{
          .sender   = sender,
          .contract = contract,
          .raw_data = psio::convert_to_frac(action{std::move(args)}),
      });
      if constexpr (!std::is_same_v<R, void>)
         return psio::convert_from_frac<R>(result);
   }
#endif
}  // namespace system_contract::auth_ec_sys
