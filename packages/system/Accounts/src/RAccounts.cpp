#include "services/system/RAccounts.hpp"

#include <psibase/dispatch.hpp>
#include <psibase/nativeTables.hpp>
#include <psibase/serveGraphQL.hpp>
#include <psibase/serveSimpleUI.hpp>
#include <services/system/Accounts.hpp>
#include <services/system/HttpServer.hpp>

#include <string>
#include <string_view>

static constexpr bool enable_print = false;

using namespace psibase;

namespace
{
   struct AccountPrefixBounds
   {
      bool                         matchNone = false;
      std::optional<AccountNumber> ge;
      std::optional<AccountNumber> lt;
   };

   AccountPrefixBounds accountPrefixBounds(std::string_view prefix)
   {
      if (prefix.empty())
         return {};

      std::string lower{prefix};
      if (lower.back() == '-')
         lower.push_back('0');
      AccountNumber lowerNum{lower};
      if (lowerNum.str() != lower || lowerNum.subaccount() != 0)
         return {.matchNone = true};

      std::string upper{prefix};
      upper.resize(10, 'z');
      AccountNumber upperNum{upper};
      upperNum.value += 256;
      return {.ge = lowerNum, .lt = upperNum};
   }
}  // namespace

namespace SystemService
{
   struct AccountsQuery
   {
      auto getAccount(AccountNumber accountName) const
      {
         Accounts::Tables tables{Accounts::service};
         return tables.open<AccountTable>().get(accountName);
      }

      auto getAccounts(std::vector<AccountNumber> accountNames) const
      {
         std::vector<std::optional<Account>> result;
         for (auto account : accountNames)
         {
            Accounts::Tables tables{Accounts::service};
            result.push_back(tables.open<AccountTable>().get(account));
         }
         return result;
      }

      auto accountsByPre(std::string prefix, psio::graphql::page_args page) const
      {
         auto                                   bounds = accountPrefixBounds(prefix);
         psio::graphql::key_range<AccountNumber> range{.ge = bounds.ge, .lt = bounds.lt};
         // No account matches: an empty range
         if (bounds.matchNone)
            range = {.ge = AccountNumber{}, .lt = AccountNumber{}};
         return psio::graphql::paginate(
             IndexView{Accounts::Tables{Accounts::service}.open<AccountTable>().getIndex<0>()},
             range, page, allRows);
      }

      auto frozenAccounts(psio::graphql::page_args page) const
      {
         return psio::graphql::paginate(
             IndexView{Accounts::Tables{Accounts::service}.open<FrozenTable>().getIndex<0>()}, page,
             allRows);
      }
   };
   PSIO_REFLECT(AccountsQuery,
                method(getAccount, accountName),
                method(getAccounts, accountNames),
                method(accountsByPre, prefix, page),
                method(frozenAccounts, page))
   PSIO_TYPE_ATTRS(AccountsQuery, psio::graphql::name_as{"Query"})

   std::optional<HttpReply> RAccounts::serveSys(HttpRequest request)
   {
      if (auto result = psibase::serveSimpleUI<Accounts, false>(request))
         return result;
      if (auto result = psibase::serveGraphQL(request, AccountsQuery{}))
         return result;
      return std::nullopt;
   }  // serveSys

}  // namespace SystemService

PSIBASE_DISPATCH(SystemService::RAccounts)
