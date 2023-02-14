#include <services/system/AuthAnySys.hpp>

#include <psibase/dispatch.hpp>
#include <psibase/print.hpp>

static constexpr bool enable_print = false;

namespace SystemService
{
   void AuthAnySys::checkAuthSys(uint32_t                    flags,
                                 psibase::AccountNumber      requester,
                                 psibase::Action             action,
                                 std::vector<ServiceMethod>  allowedActions,
                                 std::vector<psibase::Claim> claims)
   {
      if (enable_print)
         psibase::print("auth_check\n");
   }

   void AuthAnySys::canAuthUserSys(psibase::AccountNumber user)
   {
      if (enable_print)
         psibase::print("user_check\n");
   }
}  // namespace SystemService

PSIBASE_DISPATCH(SystemService::AuthAnySys)
