#include <services/system/AuthAny.hpp>
#include <services/system/StagedTx.hpp>
#include <services/system/Transact.hpp>

#include <psibase/dispatch.hpp>

#include <cstdio>

static constexpr bool enable_print = false;

using namespace psibase;

namespace SystemService
{
   void AuthAny::checkAuthSys(uint32_t                   flags,
                              AccountNumber              requester,
                              AccountNumber              sender,
                              ServiceMethod              action,
                              std::vector<ServiceMethod> allowedActions,
                              std::vector<Claim>         claims)
   {
      if (enable_print)
         std::printf("checkAuthSys\n");
   }

   void AuthAny::canAuthUserSys(AccountNumber user)
   {
      if (enable_print)
         std::printf("canAuthUserSys\n");
   }

   bool AuthAny::isAuthSys(AccountNumber sender, std::vector<AccountNumber> authorizers)
   {
      if (enable_print)
         std::printf("isAuthSys\n");

      return true;
   }

   bool AuthAny::isRejectSys(AccountNumber sender, std::vector<AccountNumber> rejecters)
   {
      if (enable_print)
         std::printf("isRejectSys\n");

      return true;
   }
}  // namespace SystemService

PSIBASE_DISPATCH(SystemService::AuthAny)
