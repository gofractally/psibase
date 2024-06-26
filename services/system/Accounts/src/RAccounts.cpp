#include "services/system/RAccounts.hpp"

#include <psibase/dispatch.hpp>
#include <psibase/nativeTables.hpp>
#include <psibase/serveContent.hpp>
#include <psibase/serveSimpleUI.hpp>
#include <psio/from_json.hpp>
#include <psio/to_json.hpp>
#include <services/system/Accounts.hpp>
#include <services/system/HttpServer.hpp>

static constexpr bool enable_print = false;

using namespace psibase;
using Tables = psibase::ServiceTables<psibase::WebContentTable>;

namespace SystemService
{
   std::optional<HttpReply> RAccounts::serveSys(HttpRequest request)
   {
      auto to_json = [](const auto& obj)
      {
         auto json = psio::convert_to_json(obj);
         return HttpReply{
             .contentType = "application/json",
             .body        = {json.begin(), json.end()},
         };
      };

      if (request.method == "GET")
      {
         // TODO: replace with GraphQL
         // if (request.target.starts_with("/api/accounts"))
         // {
         //    auto accountsTables = Accounts::Tables(Accounts::service);
         //    auto accountTable     = accountsTables.open<AccountTable>();
         //    auto accountIndex     = accountTable.getIndex<0>();

         //    std::vector<Account> rows;
         //    for (auto it = accountIndex.begin(); it != accountIndex.end(); ++it)
         //       rows.push_back(*it);
         //    return to_json(rows);
         // }

         // TODO: replace with GraphQL
         if (request.target == "/accounts")
         {
            auto accountsTables = Accounts::Tables(Accounts::service);
            auto accountTable   = accountsTables.open<AccountTable>();
            auto accountIndex   = accountTable.getIndex<0>();

            std::vector<Account> rows;
            for (auto it = accountIndex.begin(); it != accountIndex.end(); ++it)
               rows.push_back(*it);
            return to_json(rows);
         }
      }

      if (auto result = psibase::serveSimpleUI<Accounts, false>(request))
         return result;
      if (auto result = psibase::serveContent(request, Tables{getReceiver()}))
         return result;
      return std::nullopt;
   }  // serveSys

   void RAccounts::storeSys(std::string path, std::string contentType, std::vector<char> content)
   {
      psibase::check(getSender() == getReceiver(), "wrong sender");
      psibase::storeContent(std::move(path), std::move(contentType), std::move(content),
                            Tables{getReceiver()});
   }

}  // namespace SystemService

PSIBASE_DISPATCH(SystemService::RAccounts)
