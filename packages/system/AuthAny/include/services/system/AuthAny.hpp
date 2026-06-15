#pragma once

#include <services/system/Transact.hpp>

namespace SystemService
{
   struct AuthAny : psibase::Service
   {
      static constexpr psibase::AccountNumber service = psibase::AccountNumber("auth-any");

      bool checkAuthSys(uint32_t                    flags,
                        psibase::AccountNumber      requester,
                        psibase::AccountNumber      sender,
                        ServiceMethod               action,
                        std::vector<ServiceMethod>  allowedActions,
                        std::vector<psibase::Claim> claims);

      void canAuthUserSys(psibase::AccountNumber user);

      std::vector<psibase::AccountNumber> getDelegationsSys(psibase::AccountNumber      sender,
                                                         std::optional<ServiceMethod> method);

      bool isAuthSys(psibase::AccountNumber              sender,
                     std::vector<psibase::AccountNumber> authorizers);

      bool isRejectSys(psibase::AccountNumber              sender,
                       std::vector<psibase::AccountNumber> rejecters);
   };
   PSIO_REFLECT(AuthAny,  //
                method(checkAuthSys, flags, requester, sender, action, allowedActions, claims),
                method(canAuthUserSys, user),
                method(getDelegationsSys, sender, method),
                method(isAuthSys, sender, authorizers),
                method(isRejectSys, sender, rejecters)
                //
   )
   PSIBASE_REFLECT_TABLES(AuthAny)
}  // namespace SystemService
