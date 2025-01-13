#pragma once

#include <services/system/Transact.hpp>

namespace SystemService
{
   struct AuthAny : psibase::Service
   {
      static constexpr psibase::AccountNumber service = psibase::AccountNumber("auth-any");

      void checkAuthSys(uint32_t                    flags,
                        psibase::AccountNumber      requester,
                        psibase::AccountNumber      sender,
                        ServiceMethod               action,
                        std::vector<ServiceMethod>  allowedActions,
                        std::vector<psibase::Claim> claims);

      void canAuthUserSys(psibase::AccountNumber user);

      bool isAuthSys(psibase::AccountNumber              sender,
                     std::vector<psibase::AccountNumber> authorizers);

      bool isRejectSys(psibase::AccountNumber              sender,
                       std::vector<psibase::AccountNumber> rejecters);
   };
   PSIO_REFLECT(AuthAny,  //
                method(checkAuthSys, flags, requester, sender, action, allowedActions, claims),
                method(canAuthUserSys, user),
                method(isAuthSys, sender, authorizers),
                method(isRejectSys, sender, rejecters)
                //
   )
}  // namespace SystemService
