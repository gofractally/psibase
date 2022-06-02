#include <contracts/system/auth_fake_sys.hpp>

#include <psibase/dispatch.hpp>
#include <psibase/print.hpp>

static constexpr bool enable_print = false;

namespace system_contract
{
   void AuthFakeSys::checkAuthSys(psibase::Action action, std::vector<psibase::Claim> claims)
   {
      if (enable_print)
         psibase::print("auth_check\n");
   }
}  // namespace system_contract

PSIBASE_DISPATCH(system_contract::AuthFakeSys)
