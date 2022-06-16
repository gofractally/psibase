#include "contracts/system/CommonSys.hpp"

#include <contracts/system/ProxySys.hpp>
#include <psibase/dispatch.hpp>
#include <psibase/nativeTables.hpp>
#include <psibase/serveContent.hpp>
#include <psio/to_json.hpp>

static constexpr bool enable_print = false;

using namespace psibase;
using Tables = psibase::ContractTables<psibase::WebContentTable>;

namespace psibase
{
   std::optional<RpcReplyData> CommonSys::serveSys(RpcRequestData request)
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
         if (request.target == "/common/thiscontract")
         {
            std::string contractName;
            if (request.host.size() > request.rootHost.size() + 1 &&
                request.host.ends_with(request.rootHost) &&
                request.host[request.host.size() - request.rootHost.size() - 1] == '.')
               contractName.assign(request.host.begin(),
                                   request.host.end() - request.rootHost.size() - 1);
            else
               contractName = "common-sys";
            return to_json(contractName);
         }
         if (request.target == "/common/rootdomain")
            return to_json(request.rootHost);
         if (request.target == "/common/rootdomain.js")
         {
            auto js = "const rootdomain = '" + request.rootHost + "';\n";
            js +=
                "function siblingUrl(baseUrl, contract, path) {\n"
                "    let loc;\n"
                "    if (!baseUrl)\n"
                "        loc = location;\n"
                "    else\n"
                "        loc = new URL(baseUrl);\n"
                "    return loc.protocol + '//' + (contract ? contract + '.' : '') + rootdomain +\n"
                "           ':' + loc.port + '/' + (path || '').replace(/^\\/+/, '');\n"
                "}\n";
            return RpcReplyData{
                .contentType = "text/javascript",
                .body        = {js.begin(), js.end()},
            };
         }
         if (request.target == "/common/rootdomain.mjs")
         {
            auto js = "export const rootdomain = '" + request.rootHost + "';\n";
            js +=
                "export function siblingUrl(baseUrl, contract, path) {\n"
                "    let loc;\n"
                "    if (!baseUrl)\n"
                "        loc = location;\n"
                "    else\n"
                "        loc = new URL(baseUrl);\n"
                "    return loc.protocol + '//' + (contract ? contract + '.' : '') + rootdomain +\n"
                "           ':' + loc.port + '/' + (path || '').replace(/^\\/+/, '');\n"
                "}\n";
            return RpcReplyData{
                .contentType = "text/javascript",
                .body        = {js.begin(), js.end()},
            };
         }
      }

      if (request.method == "POST")
      {
         if (request.target == "/common/pack/Transaction")
         {
            request.body.push_back(0);
            psio::json_token_stream jstream{request.body.data()};
            Transaction             trx;
            psio::from_json(trx, jstream);
            return RpcReplyData{
                .contentType = "application/octet-stream",
                .body        = psio::convert_to_frac(trx),
            };
         }
         if (request.target == "/common/pack/SignedTransaction")
         {
            request.body.push_back(0);
            psio::json_token_stream jstream{request.body.data()};
            SignedTransaction       trx;
            psio::from_json(trx, jstream);
            return RpcReplyData{
                .contentType = "application/octet-stream",
                .body        = psio::convert_to_frac(trx),
            };
         }
      }

      if (auto result = psibase::serveContent(request, Tables{getReceiver()}))
         return result;
      return std::nullopt;
   }  // CommonSys::serveSys

   void CommonSys::storeSys(std::string path, std::string contentType, std::vector<char> content)
   {
      psibase::check(getSender() == getReceiver(), "wrong sender");
      psibase::storeContent(std::move(path), std::move(contentType), std::move(content),
                            Tables{getReceiver()});
   }

   std::optional<RpcReplyData> CommonSys::serveCommon(RpcRequestData request)
   {
      /*
      <script src="https://unpkg.com/react@18/umd/react.production.min.js" crossorigin></script>
      <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js" crossorigin></script>
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/semantic-ui/2.4.1/semantic.min.css" />

      <div id="commonRoot"></div>
      <div class="ui container" style="margin-top: 10px" id="root"></div>

      <script src="common/rootdomain.js"></script>
      <script src="ui/commonIndex.js" type="module"></script>
      <script src="ui/index.js" type="module"></script>
      */

      if (request.method == "GET")
      {
         if (request.target == "/" || request.target == "/ui/commonIndex.js")
         {
            auto index =
                ContractTables<WebContentTable>{contract}.open<WebContentTable>().getIndex<0>();
            if (auto content = index.get(request.target))
            {
               return RpcReplyData{
                   .contentType = content->contentType,
                   .body        = content->content,
               };
            }
         }
      }
      return std::nullopt;
   }

}  // namespace psibase

PSIBASE_DISPATCH(psibase::CommonSys)
