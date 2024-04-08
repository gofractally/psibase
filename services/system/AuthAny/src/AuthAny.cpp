#include <services/system/AuthAny.hpp>

#include <psibase/dispatch.hpp>

#include <cstdio>

static constexpr bool enable_print = false;

namespace SystemService
{
   void AuthAny::checkAuthSys(uint32_t                    flags,
                              psibase::AccountNumber      requester,
                              psibase::AccountNumber      sender,
                              ServiceMethod               action,
                              std::vector<ServiceMethod>  allowedActions,
                              std::vector<psibase::Claim> claims)
   {
      if (enable_print)
         std::printf("auth_check\n");
   }

   void AuthAny::canAuthUserSys(psibase::AccountNumber user)
   {
      if (enable_print)
         std::printf("user_check\n");
   }
}  // namespace SystemService

PSIBASE_DISPATCH(SystemService::AuthAny)
