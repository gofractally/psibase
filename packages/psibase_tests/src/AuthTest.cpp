#include <services/test/AuthTest.hpp>

#include <algorithm>
#include <psibase/dispatch.hpp>
#include <services/system/Accounts.hpp>

using namespace psibase;
using namespace TestService;
using namespace SystemService;

namespace
{
   bool checkThreshold(std::size_t                       threshold,
                       const std::vector<AccountNumber>& deps,
                       const std::vector<AccountNumber>& approved)
   {
      std::size_t matching = 0;
      for (AccountNumber dep : deps)
      {
         if (std::ranges::contains(approved, dep))
         {
            if (++matching >= threshold)
               return true;
         }
      }
      return false;
   }

   AuthRow getAuthRow(AccountNumber account, std::optional<ServiceMethod> action)
   {
      if (action)
      {
         if (auto result = AuthTest{}.open<AuthMethodTable>().get(std::tuple(account, *action)))
         {
            return std::move(result->auth);
         }
      }
      return AuthTest{}.open<AuthTable>().get(account).value();
   }
}  // namespace

void AuthTest::newAccount(AccountNumber              account,
                          std::vector<AccountNumber> deps,
                          std::uint32_t              threshold)
{
   check(threshold <= deps.size(), "Threshold too big");
   to<Accounts>().newAccount(account, getReceiver(), NewAccountMode::requireNew);
   open<AuthTable>().put({account, std::move(deps), threshold});
}

void AuthTest::canAuthUserSys(AccountNumber account)
{
   check(open<AuthTable>().get(account).has_value(), "Auth missing");
}

void AuthTest::setAuth(AccountNumber                account,
                       std::vector<AccountNumber>   deps,
                       std::uint32_t                threshold,
                       std::optional<ServiceMethod> action)
{
   check(getSender() == getReceiver(), "Wrong sender");
   check(threshold <= deps.size(), "Threshold too big");
   auto row = AuthRow{account, std::move(deps), threshold};
   if (action)
      open<AuthMethodTable>().put({row, *action});
   else
      open<AuthTable>().put(row);
}

auto AuthTest::getDlgsSys(psibase::AccountNumber account, std::optional<ServiceMethod> action)
    -> std::vector<psibase::AccountNumber>
{
   return getAuthRow(account, action).deps;
}

bool AuthTest::isAuthSys(AccountNumber                account,
                         std::vector<AccountNumber>   approved,
                         std::optional<ServiceMethod> action)
{
   auto row = getAuthRow(account, action);
   return checkThreshold(row.threshold, row.deps, approved);
}

bool AuthTest::isRejectSys(AccountNumber                account,
                           std::vector<AccountNumber>   rejected,
                           std::optional<ServiceMethod> action)
{
   auto row = getAuthRow(account, action);
   return checkThreshold(row.deps.size() - row.threshold + 1, row.deps, rejected);
}

PSIBASE_DISPATCH(AuthTest)
