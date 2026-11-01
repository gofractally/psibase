#include <services/system/AuthNone.hpp>

#include <psibase/dispatch.hpp>

using namespace psibase;

namespace SystemService
{
   bool AuthNone::checkAuthSys(uint32_t, AccountNumber, ServiceMethod, std::vector<Claim>)
   {
      return false;
   }

   void AuthNone::canAuthUserSys(AccountNumber) {}

   std::vector<AccountNumber> AuthNone::getDlgsSys(AccountNumber)
   {
      return {};
   }

   bool AuthNone::isAuthSys(AccountNumber, std::vector<AccountNumber>)
   {
      return false;
   }

   bool AuthNone::isRejectSys(AccountNumber, std::vector<AccountNumber>)
   {
      return true;
   }
}  // namespace SystemService

PSIBASE_DISPATCH(SystemService::AuthNone)
