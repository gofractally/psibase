#pragma once

#include <psibase/psibase.hpp>
#include <services/system/TransactionSys.hpp>
#include <services/user/InviteErrors.hpp>

namespace UserService
{
   class AuthInviteSys
   {
     public:
      static constexpr auto service = psibase::AccountNumber("auth-inv-sys");

      using Tables = psibase::ServiceTables<psibase::WebContentTable>;

      void checkAuthSys(uint32_t                                  flags,
                        psibase::AccountNumber                    requester,
                        psibase::AccountNumber                    sender,
                        SystemService::ServiceMethod              action,
                        std::vector<SystemService::ServiceMethod> allowedActions,
                        std::vector<psibase::Claim>               claims);
      void canAuthUserSys(psibase::AccountNumber user);

      void requireAuth(const psibase::PublicKey& pubkey);

      std::optional<psibase::HttpReply> serveSys(psibase::HttpRequest request);

      void storeSys(std::string path, std::string contentType, std::vector<char> content);
   };
   PSIO_REFLECT(AuthInviteSys,  //
                method(checkAuthSys, flags, requester, sender, action, allowedActions, claims),
                method(canAuthUserSys, user),
                method(requireAuth, pubkey),
                method(serveSys, request),
                method(storeSys, path, contentType, content)
                //
   )
}  // namespace UserService
