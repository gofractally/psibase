#include "RTokenSys.hpp"

#include <psibase/dispatch.hpp>
#include <psibase/print.hpp>
#include <psibase/serveGraphQL.hpp>
#include <psibase/serveSimpleUI.hpp>
#include <string>
#include <vector>
#include "TokenSys.hpp"

using namespace UserContract;
using namespace std;
using namespace psibase;

namespace
{
   auto simplePage = [](std::string str)
   {
      auto d = string("<html><div>" + str + "</div></html>");

      return RpcReplyData{.contentType = "text/html",
                          .body        = std::vector<char>{d.begin(), d.end()}};
   };
}

struct TokenQuery
{
   auto balances() const
   {  //
      return TableIndex<BalanceRecord, uint32_t>{DbId::contract, {}, false};
   }
};
PSIO_REFLECT(TokenQuery, method(balances))

optional<RpcReplyData> RpcTokenSys::serveSys(RpcRequestData request)
{
   if (request.method == "GET" &&
       (request.target == "/simple" || request.target == "/action_templates"))
   {
      if (request.target == "/simple")
      {
         request.target = "/";
      }
      if (auto result = serveSimpleUI<TokenSys, true>(request))
         return result;
   }

   if (auto result = serveContent(request, TokenSys::Tables{getReceiver()}))
      return result;

   if (auto result = serveGraphQL(request, TokenQuery{}))
      return result;
   return nullopt;
}

void RpcTokenSys::storeSys(string path, string contentType, vector<char> content)
{
   check(getSender() == getReceiver(), "wrong sender");
   storeContent(move(path), move(contentType), move(content), TokenSys::Tables{getReceiver()});
}

PSIBASE_DISPATCH(UserContract::RpcTokenSys)