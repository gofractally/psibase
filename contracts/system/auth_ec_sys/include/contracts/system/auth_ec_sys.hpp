#pragma once

#include <psibase/Contract.hpp>

namespace system_contract
{
   struct AuthEcSys : psibase::Contract<AuthEcSys>
   {
      static constexpr auto contract = psibase::AccountNumber("auth-ec-sys");

      void checkAuthSys(psibase::Action action, std::vector<psibase::Claim> claims);
      void setKey(psibase::PublicKey key);
   };
   PSIO_REFLECT(AuthEcSys,  //
                method(checkAuthSys, action, claims),
                method(setKey, account, key))
}  // namespace system_contract
