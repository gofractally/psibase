#pragma once

#include <services/system/TransactionSys.hpp>

namespace SystemService
{
   struct AuthAnySys : psibase::Service<AuthAnySys>
   {
      static constexpr psibase::AccountNumber service = psibase::AccountNumber("auth-any-sys");

      void checkAuthSys(uint32_t                    flags,
                        psibase::AccountNumber      requester,
                        psibase::Action             action,
                        std::vector<ServiceMethod>  allowedActions,
                        std::vector<psibase::Claim> claims);
      void checkUserSys(psibase::AccountNumber user);
   };
   PSIO_REFLECT(AuthAnySys,  //
                method(checkAuthSys, flags, requester, action, allowedActions, claims),
                method(checkUserSys, user)
                //
   )
}  // namespace SystemService
