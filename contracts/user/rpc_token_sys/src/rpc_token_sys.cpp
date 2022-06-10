#include <contracts/user/rpc_token_sys.hpp>
#include <psibase/dispatch.hpp>
#include <psibase/print.hpp>
#include <string>
#include <vector>
#include "token_sys.hpp"

using namespace UserContract;
using namespace std;
using namespace psibase;

optional<RpcReplyData> RpcTokenSys::serveSys(RpcRequestData request)
{
   // if (auto result = serveGraphQL(request, Query{}))
   //    return result;
   if (auto result = serveContent(request, TokenSys::Tables{getReceiver()}))
      return result;
   return nullopt;
}

void RpcTokenSys::storeSys(string path, string contentType, vector<char> content)
{
   check(getSender() == getReceiver(), "wrong sender");
   storeContent(move(path), move(contentType), move(content), TokenSys::Tables{getReceiver()});
}

PSIBASE_DISPATCH(UserContract::RpcTokenSys)