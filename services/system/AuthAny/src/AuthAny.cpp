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
         std::printf("auth_check\n");
   }

   void AuthAny::canAuthUserSys(AccountNumber user)
   {
      if (enable_print)
         std::printf("user_check\n");
   }

   void AuthAny::stagedAccept(uint32_t stagedTxId, AccountNumber actor)
   {
      check(getSender() == "staged-tx"_a, "can only be called by staged-tx");

      auto [execute, allowedActions] = to<StagedTxService>().get_exec_info(stagedTxId);
      to<Transact>().runAs(std::move(execute), allowedActions);
   }

   void AuthAny::stagedReject(uint32_t stagedTxId, AccountNumber actor)
   {
      check(false, "not supported");
   }
}  // namespace SystemService

PSIBASE_DISPATCH(SystemService::AuthAny)
