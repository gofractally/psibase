#include <services/system/AuthAnySys.hpp>

#include <psibase/dispatch.hpp>
#include <psibase/print.hpp>

static constexpr bool enable_print = false;

namespace system_contract
{
   void AuthAnySys::checkAuthSys(uint32_t                    flags,
                                 psibase::AccountNumber      requester,
                                 psibase::Action             action,
                                 std::vector<ContractMethod> allowedActions,
                                 std::vector<psibase::Claim> claims)
   {
      if (enable_print)
         psibase::print("auth_check\n");
   }
}  // namespace system_contract

PSIBASE_DISPATCH(system_contract::AuthAnySys)
