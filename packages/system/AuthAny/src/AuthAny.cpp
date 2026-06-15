#include <services/system/AuthAny.hpp>
#include <services/system/StagedTx.hpp>
#include <services/system/Transact.hpp>

#include <psibase/dispatch.hpp>

#include <cstdio>

static constexpr bool enable_print = false;

using namespace psibase;

namespace SystemService
{
   bool AuthAny::checkAuthSys(uint32_t                   flags,
                              AccountNumber              requester,
                              AccountNumber              sender,
                              ServiceMethod              action,
                              std::vector<ServiceMethod> allowedActions,
                              std::vector<Claim>         claims)
   {
      if (enable_print)
         std::printf("checkAuthSys\n");
      return true;
   }

   void AuthAny::canAuthUserSys(AccountNumber user)
   {
      if (enable_print)
         std::printf("canAuthUserSys\n");
   }

   std::vector<AccountNumber> AuthAny::getDelegations(AccountNumber              sender,
                                                      std::optional<ServiceMethod> method)
   {
      if (enable_print)
         std::printf("getDelegations\n");
      return {};
   }

   bool AuthAny::isAuthSys(AccountNumber              sender,
                           std::vector<AccountNumber> authorizers,
                           std::optional<ServiceMethod> method)
   {
      if (enable_print)
         std::printf("isAuthSys\n");

      return std::ranges::contains(authorizers, sender);
   }

   bool AuthAny::isRejectSys(AccountNumber              sender,
                             std::vector<AccountNumber> rejecters,
                             std::optional<ServiceMethod> method)
   {
      if (enable_print)
         std::printf("isRejectSys\n");

      return std::ranges::contains(rejecters, sender);
   }
}  // namespace SystemService

PSIBASE_DISPATCH(SystemService::AuthAny)
