#pragma once

#include <psibase/Table.hpp>
#include <psibase/crypto.hpp>
#include <psibase/psibase.hpp>
#include <psibase/serveContent.hpp>
#include <services/system/TransactionSys.hpp>
#include <services/user/InviteErrors.hpp>

namespace UserService
{
   class AuthInviteSys
   {
     public:
      static constexpr auto service = psibase::AccountNumber("auth-inv-sys");

      void checkAuthSys(uint32_t                                  flags,
                        psibase::AccountNumber                    requester,
                        psibase::Action                           action,
                        std::vector<SystemService::ServiceMethod> allowedActions,
                        std::vector<psibase::Claim>               claims);
      void checkUserSys(psibase::AccountNumber user);
   };
   PSIO_REFLECT(AuthInviteSys,  //
                method(checkAuthSys, flags, requester, action, allowedActions, claims),
                method(checkUserSys, user)
                //
   )
}  // namespace UserService
