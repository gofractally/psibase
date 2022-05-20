#include "contracts/system/common_sys.hpp"

#include <contracts/system/account_sys.hpp>
#include <contracts/system/proxy_sys.hpp>
#include <psibase/dispatch.hpp>
#include <psibase/nativeTables.hpp>
#include <psio/to_json.hpp>

static constexpr bool enable_print = false;

using table_num = uint16_t;
using namespace psibase;

static constexpr table_num web_content_table = 1;

inline auto webContentKey(AccountNumber thisContract, std::string_view path)
{
   return std::tuple{thisContract, web_content_table, path};
}
struct WebContentRow
{
   std::string       path        = {};
   std::string       contentType = {};
   std::vector<char> content     = {};

   auto key(AccountNumber thisContract) { return webContentKey(thisContract, path); }
};
PSIO_REFLECT(WebContentRow, path, contentType, content)

namespace psibase
{
   std::optional<RpcReplyData> common_sys::serveSys(RpcRequestData request)
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
         auto content = kvGet<WebContentRow>(webContentKey(getReceiver(), request.target));
         if (!!content)
         {
            return RpcReplyData{
                .contentType = content->contentType,
                .body        = content->content,
            };
         }
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
                "function siblingUrl(contract, path) {\n"
                "    return location.protocol + '//' + (contract ? contract + '.' : '') +\n"
                "           rootdomain + ':' + location.port + '/' + (path || '');\n"
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
                "export function siblingUrl(contract, path) {\n"
                "    return location.protocol + '//' + (contract ? contract + '.' : '') +\n"
                "           rootdomain + ':' + location.port + '/' + (path || '');\n"
                "}\n";
            return RpcReplyData{
                .contentType = "text/javascript",
                .body        = {js.begin(), js.end()},
            };
         }
      }

      if (request.method == "POST")
      {
         // TODO: move to an ABI wasm?
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

      return std::nullopt;
   }  // common_sys::serveSys

   void common_sys::storeSys(psio::const_view<std::string>       path,
                             psio::const_view<std::string>       contentType,
                             psio::const_view<std::vector<char>> content)
   {
      check(getSender() == getReceiver(), "wrong sender");

      // TODO
      auto              size = content.size();
      std::vector<char> c(size);
      for (size_t i = 0; i < size; ++i)
         c[i] = content[i];

      // TODO: avoid copies before pack
      WebContentRow row{
          .path        = path,
          .contentType = contentType,
          .content     = std::move(c),
      };
      kvPut(row.key(getReceiver()), row);
   }

}  // namespace psibase

PSIBASE_DISPATCH(psibase::common_sys)
