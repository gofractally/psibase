#pragma once

#include <services/system/TransactionSys.hpp>

namespace SystemService
{
   struct AuthAny : psibase::Service<AuthAny>
   {
      static constexpr psibase::AccountNumber service = psibase::AccountNumber("auth-any");

      void checkAuthSys(uint32_t                    flags,
                        psibase::AccountNumber      requester,
                        psibase::AccountNumber      sender,
                        ServiceMethod               action,
                        std::vector<ServiceMethod>  allowedActions,
                        std::vector<psibase::Claim> claims);
      void canAuthUserSys(psibase::AccountNumber user);
   };
   PSIO_REFLECT(AuthAny,  //
                method(checkAuthSys, flags, requester, sender, action, allowedActions, claims),
                method(canAuthUserSys, user)
                //
   )
}  // namespace SystemService
