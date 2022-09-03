#pragma once

#include <services/system/TransactionSys.hpp>

namespace system_contract
{
   struct AuthAnySys : psibase::Service<AuthAnySys>
   {
      static constexpr psibase::AccountNumber service = psibase::AccountNumber("auth-any-sys");

      void checkAuthSys(uint32_t                    flags,
                        psibase::AccountNumber      requester,
                        psibase::Action             action,
                        std::vector<ContractMethod> allowedActions,
                        std::vector<psibase::Claim> claims);
   };
   PSIO_REFLECT(AuthAnySys, method(checkAuthSys, flags, requester, action, allowedActions, claims))
}  // namespace system_contract
