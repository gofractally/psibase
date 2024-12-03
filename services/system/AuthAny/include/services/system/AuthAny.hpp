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

      void stagedAccept(uint32_t staged_tx_id, psibase::AccountNumber actor);

      void stagedReject(uint32_t staged_tx_id, psibase::AccountNumber actor);
   };
   PSIO_REFLECT(AuthAny,  //
                method(checkAuthSys, flags, requester, sender, action, allowedActions, claims),
                method(canAuthUserSys, user),
                method(stagedAccept, staged_tx_id, actor),
                method(stagedReject, staged_tx_id, actor)
                //
   )
}  // namespace SystemService
