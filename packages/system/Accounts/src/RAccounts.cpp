#include "services/system/RAccounts.hpp"

#include <psibase/dispatch.hpp>
#include <psibase/nativeTables.hpp>
#include <psibase/serveGraphQL.hpp>
#include <psibase/serveSimpleUI.hpp>
#include <psio/from_json.hpp>
#include <psio/to_json.hpp>
#include <services/system/Accounts.hpp>
#include <services/system/HttpServer.hpp>

#include <algorithm>
#include <string>
#include <string_view>

static constexpr bool enable_print = false;

using namespace psibase;

namespace
{
   // A base-name prefix is one account-number range: numbers follow name
   // order, and subaccounts occupy the low 8 bits right after the base name.
   struct AccountPrefixBounds
   {
      bool                         matchNone = false;
      std::optional<AccountNumber> ge;
      std::optional<AccountNumber> lt;
   };

   AccountPrefixBounds accountPrefixBounds(std::string_view prefix)
   {
      constexpr std::string_view alphabet = "-0123456789abcdefghijklmnopqrstuvwxyz";
      if (prefix.empty())
         return {};
      if (prefix.size() > 10 || prefix.front() == '-' ||
          prefix.find("--") != std::string_view::npos ||
          (prefix.size() == 10 && prefix.back() == '-') ||
          !std::ranges::all_of(
              prefix, [&](char ch) { return alphabet.find(ch) != std::string_view::npos; }))
         return {.matchNone = true};

      std::string lower{prefix};
      if (lower.back() == '-')
         lower.push_back('0');
      AccountNumber lowerNum{lower};
      if (lowerNum.str() != lower)
         return {.matchNone = true};

      std::string upper{prefix};
      bool        carried = true;
      for (int i = static_cast<int>(upper.size()) - 1; i >= 0 && carried; --i)
      {
         auto pos = alphabet.find(upper[static_cast<std::size_t>(i)]);
         if (pos == std::string_view::npos)
            return {.matchNone = true};
         if (pos + 1 < alphabet.size())
         {
            upper[static_cast<std::size_t>(i)] = alphabet[pos + 1];
            upper.resize(static_cast<std::size_t>(i) + 1);
            carried = false;
         }
         else
            upper.resize(static_cast<std::size_t>(i));
      }
      if (carried)
         return {.ge = lowerNum};

      AccountNumber upperNum{upper};
      if (upperNum.str() != upper)
         return {.matchNone = true};
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
         using AccountConnection = Connection<Account, "AccountConnection", "AccountEdge">;
         Accounts::Tables tables{Accounts::service};
         auto             accounts = tables.open<AccountTable>();
         auto             frozen   = tables.open<FrozenTable>().getIndex<0>();
         return makeConnection<AccountConnection>(
             frozen, {}, {}, {}, {}, first, last, before, after,
             [&](const FrozenAccount& row)
             {
                auto account = accounts.get(row.account);
                check(account.has_value(), "account " + row.account.str() + " does not exist");
                return *account;
             });
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
