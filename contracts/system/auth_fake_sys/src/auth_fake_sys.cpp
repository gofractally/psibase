#include <contracts/system/auth_fake_sys.hpp>

#include <psibase/crypto.hpp>
#include <psibase/dispatch.hpp>
#include <psibase/native_tables.hpp>

using namespace psibase;

static constexpr bool enable_print = false;

namespace system_contract
{
   uint8_t auth_fake_sys::authCheck(const_view<Action> act, const_view<std::vector<Claim>> claims)
   {
      return 0;
   }
}  // namespace system_contract
PSIBASE_DISPATCH(system_contract::auth_fake_sys)
