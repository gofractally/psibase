#pragma once

#include <psibase/Contract.hpp>

namespace system_contract
{
   struct AuthFakeSys : psibase::Contract<AuthFakeSys>
   {
      static constexpr psibase::AccountNumber contract = psibase::AccountNumber("auth-fake-sys");

      void checkAuthSys(psibase::Action action, std::vector<psibase::Claim> claims);
   };
   PSIO_REFLECT(AuthFakeSys, method(checkAuthSys, action, claims))
}  // namespace system_contract
