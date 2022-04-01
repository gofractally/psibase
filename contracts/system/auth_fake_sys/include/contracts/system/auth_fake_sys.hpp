#pragma once

#include <psibase/intrinsic.hpp>
#include <psibase/native_tables.hpp>
#include <psio/from_bin.hpp>
#include <psio/to_bin.hpp>

namespace system_contract::auth_fake_sys
{
   static constexpr psibase::AccountNumber contract = psibase::AccountNumber("auth-fake-sys");

   struct auth_check
   {
      psibase::action             action;
      std::vector<psibase::claim> claims;
   };
   PSIO_REFLECT(auth_check, action, claims)

   using action = std::variant<auth_check>;

#ifdef __wasm__
   template <typename T, typename R = typename T::return_type>
   R call(psibase::account_num sender, T args)
   {
      auto result = psibase::call(psibase::action{
          .sender   = sender,
          .contract = contract,
          .raw_data = psio::convert_to_frac(action{std::move(args)}),
      });
      if constexpr (!std::is_same_v<R, void>)
         return psio::convert_from_frac<R>(result);
   }
#endif
}  // namespace system_contract::auth_fake_sys
