#include <contracts/user/RTokenSys.hpp>
#include <contracts/user/TokenSys.hpp>
#include <psibase/dispatch.hpp>
#include <psibase/print.hpp>
#include <psibase/serveGraphQL.hpp>
#include <psibase/serveSimpleUI.hpp>
#include <string>
#include <vector>

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

// TODO: Replace queries with gql when it supports more than simple keys
// struct TokenQuery
// {
//    auto balances() const
//    {  //
//       return TableIndex<BalanceRecord, decltype(BalanceRecord::key)>{DbId::contract, {}, false};
//    }
// };
// PSIO_REFLECT(TokenQuery, method(balances))

optional<RpcReplyData> RTokenSys::serveSys(RpcRequestData request)
{
   if (auto result = _serveRestEndpoints(request))
      return result;

   if (auto result = serveContent(request, TokenSys::Tables{getReceiver()}))
      return result;

   // if (auto result = serveGraphQL(request, TokenQuery{}))
   //    return result;
   return nullopt;
}

void RTokenSys::storeSys(string path, string contentType, vector<char> content)
{
   check(getSender() == getReceiver(), "wrong sender");
   storeContent(move(path), move(contentType), move(content), TokenSys::Tables{getReceiver()});
}

std::optional<RpcReplyData> RTokenSys::_serveRestEndpoints(RpcRequestData& request)
{
   auto to_json = [](const auto& obj)
   {
      auto json = psio::convert_to_json(obj);
      return RpcReplyData{
          .contentType = "application/json",
          .body        = {json.begin(), json.end()},
      };
   };

   if (request.method == "GET")
   {
      if (request.target == "/simple" || request.target == "/action_templates")
      {
         if (request.target == "/simple")
         {
            request.target = "/";
         }
         if (auto result = serveSimpleUI<TokenSys, true>(request))
            return result;
      }
      if (request.target == "/balances")
      {
         TokenSys::Tables db{TokenSys::contract};
         auto             idx = db.open<TokenTable_t>().getIndex<0>();
         check(idx.begin() != idx.end(), "No tokens");

         auto                       balIdx = db.open<BalanceTable_t>().getIndex<0>();
         std::vector<BalanceRecord> balances;
         TID                        tokenId = 1;
         for (auto itr = idx.begin(); itr != idx.end(); ++itr)
         {
            balances.push_back(at<TokenSys>().getBalance(tokenId, "alice"_a).unpack());
            ++tokenId;
         }

         return to_json(balances);
      }
   }

   return std::nullopt;
}

PSIBASE_DISPATCH(UserContract::RTokenSys)