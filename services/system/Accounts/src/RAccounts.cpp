#include "services/system/RAccounts.hpp"

#include <psibase/dispatch.hpp>
#include <psibase/nativeTables.hpp>
#include <psibase/serveGraphQL.hpp>
#include <psibase/serveSimpleUI.hpp>
#include <psio/from_json.hpp>
#include <psio/to_json.hpp>
#include <services/system/Accounts.hpp>
#include <services/system/HttpServer.hpp>

static constexpr bool enable_print = false;

using namespace psibase;

namespace SystemService
{
   struct AccountsQuery
   {
      auto getAccount(AccountNumber account) const
      {
         Accounts::Tables tables{Accounts::service};
         return tables.open<AccountTable>().get(account);
      }
   };
   PSIO_REFLECT(AccountsQuery, method(getAccount, account));

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
