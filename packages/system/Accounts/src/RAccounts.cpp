#include "services/system/RAccounts.hpp"

#include <psibase/dispatch.hpp>
#include <psibase/nativeTables.hpp>
#include <psibase/serveGraphQL.hpp>
#include <psibase/serveSimpleUI.hpp>
#include <psio/from_json.hpp>
#include <psio/to_json.hpp>
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

      auto accountsByPre(std::string                prefix,
                         std::optional<uint32_t>    first,
                         std::optional<uint32_t>    last,
                         std::optional<std::string> before,
                         std::optional<std::string> after) const
      {
         using AccountConnection = Connection<Account, "AccountConnection", "AccountEdge">;
         auto bounds             = accountPrefixBounds(prefix);
         if (bounds.matchNone)
            return AccountConnection{};
         auto index = Accounts::Tables{Accounts::service}.open<AccountTable>().getIndex<0>();
         return makeConnection<AccountConnection>(index, {}, bounds.ge, bounds.lt, {}, first, last,
                                                  before, after);
      }

      auto frozenAccounts(std::optional<uint32_t>    first,
                          std::optional<uint32_t>    last,
                          std::optional<std::string> before,
                          std::optional<std::string> after) const
      {
         using FrozenConnection =
             Connection<FrozenAccount, "FrozenAccountConnection", "FrozenAccountEdge">;
         auto index = Accounts::Tables{Accounts::service}.open<FrozenTable>().getIndex<0>();
         return makeConnection<FrozenConnection>(index, {}, {}, {}, {}, first, last, before,
                                                 after);
      }
   };
   PSIO_REFLECT(AccountsQuery,
                method(getAccount, accountName),
                method(getAccounts, accountNames),
                method(accountsByPre, prefix, first, last, before, after),
                method(frozenAccounts, first, last, before, after))

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
