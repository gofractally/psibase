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
}  // namespace

void AuthTest::newAccount(AccountNumber              account,
                          std::vector<AccountNumber> deps,
                          std::uint32_t              threshold)
{
   check(threshold <= deps.size(), "Threshold too big");
   bool created = to<Accounts>().newAccount(account, getReceiver(), true);
   check(created, "Account already exists");
   open<AuthTable>().put({account, std::move(deps), threshold});
}

void AuthTest::canAuthUserSys(AccountNumber account)
{
   check(open<AuthTable>().get(account).has_value(), "Auth missing");
}

void AuthTest::setAuth(AccountNumber              account,
                       std::vector<AccountNumber> deps,
                       std::uint32_t              threshold)
{
   check(getSender() == getReceiver(), "Wrong sender");
   check(threshold <= deps.size(), "Threshold too big");
   open<AuthTable>().put({account, std::move(deps), threshold});
}

auto AuthTest::getDlgsSys(psibase::AccountNumber account) -> std::vector<psibase::AccountNumber>
{
   return open<AuthTable>().get(account).value().deps;
}

bool AuthTest::isAuthSys(AccountNumber account, std::vector<AccountNumber> approved)
{
   auto row = open<AuthTable>().get(account).value();
   return checkThreshold(row.threshold, row.deps, approved);
}

bool AuthTest::isRejectSys(AccountNumber account, std::vector<AccountNumber> rejected)
{
   auto row = open<AuthTable>().get(account).value();
   return checkThreshold(row.deps.size() - row.threshold + 1, row.deps, rejected);
}

PSIBASE_DISPATCH(AuthTest)
