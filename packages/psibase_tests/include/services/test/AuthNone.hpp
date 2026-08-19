#pragma once

#include <services/system/Transact.hpp>

namespace TestService
{
   struct AuthNone : psibase::Service
   {
      static constexpr psibase::AccountNumber service = psibase::AccountNumber("auth-none");

      bool checkAuthSys(uint32_t                                  flags,
                        psibase::AccountNumber                    requester,
                        psibase::AccountNumber                    sender,
                        SystemService::ServiceMethod              action,
                        std::vector<SystemService::ServiceMethod> allowedActions,
                        std::vector<psibase::Claim>               claims);

      void canAuthUserSys(psibase::AccountNumber user);

      bool isAuthSys(psibase::AccountNumber              sender,
                     std::vector<psibase::AccountNumber> authorizers);

      bool isRejectSys(psibase::AccountNumber              sender,
                       std::vector<psibase::AccountNumber> rejecters);
   };
   PSIO_REFLECT(AuthNone,  //
                method(checkAuthSys, flags, requester, sender, action, allowedActions, claims),
                method(canAuthUserSys, user),
                method(isAuthSys, sender, authorizers),
                method(isRejectSys, sender, rejecters)
                //
   )
   PSIBASE_REFLECT_TABLES(AuthNone)
}  // namespace TestService
