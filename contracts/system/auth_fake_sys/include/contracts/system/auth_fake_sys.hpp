#pragma once

#include <psibase/nativeFunctions.hpp>
#include <psibase/nativeTables.hpp>
#include <psio/from_bin.hpp>
#include <psio/to_bin.hpp>

namespace system_contract::auth_fake_sys
{
   static constexpr psibase::AccountNumber contract = psibase::AccountNumber("auth-fake-sys");

   struct auth_check
   {
      psibase::Action             action;
      std::vector<psibase::Claim> claims;
   };
   PSIO_REFLECT(auth_check, action, claims)

   using action = std::variant<auth_check>;

#ifdef __wasm__
   template <typename T, typename R = typename T::return_type>
   R call(psibase::AccountNumber sender, T args)
   {
      auto result = psibase::call(psibase::Action{
          .sender   = sender,
          .contract = contract,
          .rawData  = psio::convert_to_frac(psibase::Action{std::move(args)}),
      });
      if constexpr (!std::is_same_v<R, void>)
         return psio::convert_from_frac<R>(result);
   }
#endif
}  // namespace system_contract::auth_fake_sys
