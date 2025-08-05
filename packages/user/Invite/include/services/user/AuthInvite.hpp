#pragma once

#include <psibase/psibase.hpp>
#include <services/system/AuthSig.hpp>
#include <services/system/Transact.hpp>
#include <services/user/InviteErrors.hpp>

namespace UserService
{
   class AuthInvite
   {
     public:
      static constexpr auto service = psibase::AccountNumber("auth-invite");

      void checkAuthSys(uint32_t                                  flags,
                        psibase::AccountNumber                    requester,
                        psibase::AccountNumber                    sender,
                        SystemService::ServiceMethod              action,
                        std::vector<SystemService::ServiceMethod> allowedActions,
                        std::vector<psibase::Claim>               claims);
      void canAuthUserSys(psibase::AccountNumber user);

      // Callable by any action that wants to confirm that the current transaction
      // contains a claim for the specified public key.
      void requireAuth(const SystemService::AuthSig::SubjectPublicKeyInfo& pubkey);

      std::optional<psibase::HttpReply> serveSys(psibase::HttpRequest request);
   };
   PSIO_REFLECT(AuthInvite,  //
                method(checkAuthSys, flags, requester, sender, action, allowedActions, claims),
                method(canAuthUserSys, user),
                method(requireAuth, pubkey),
                method(serveSys, request),
                //
   )

   PSIBASE_REFLECT_TABLES(AuthInvite)
}  // namespace UserService
