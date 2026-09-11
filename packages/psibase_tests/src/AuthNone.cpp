#include <services/test/AuthNone.hpp>

#include <psibase/dispatch.hpp>

using namespace psibase;
using namespace SystemService;
using namespace TestService;

bool AuthNone::checkAuthSys(std::uint32_t      flags,
                            AccountNumber      sender,
                            ServiceMethod      action,
                            std::vector<Claim> claims)
{
   return false;
}

void AuthNone::canAuthUserSys(AccountNumber user) {}

std::vector<psibase::AccountNumber> AuthNone::getDlgsSys(psibase::AccountNumber)
{
   return {};
}

bool AuthNone::isAuthSys(AccountNumber sender, std::vector<AccountNumber> authorizers)
{
   return false;
}

bool AuthNone::isRejectSys(AccountNumber sender, std::vector<AccountNumber> rejecters)
{
   return true;
}

PSIBASE_DISPATCH(AuthNone)
