#include "contracts/system/common_sys.hpp"

#include <contracts/system/account_sys.hpp>
#include <contracts/system/proxy_sys.hpp>
#include <psibase/dispatch.hpp>
#include <psibase/native_tables.hpp>
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
   std::optional<rpc_reply_data> common_sys::serveSys(rpc_request_data request)
   {
      auto to_json = [](const auto& obj)
      {
         auto json = psio::convert_to_json(obj);
         return rpc_reply_data{
             .contentType = "application/json",
             .reply       = {json.begin(), json.end()},
         };
      };

      if (request.method == "GET")
      {
         auto content = kv_get<WebContentRow>(webContentKey(get_receiver(), request.target));
         if (!!content)
         {
            return rpc_reply_data{
                .contentType = content->contentType,
                .reply       = content->content,
            };
         }

         if (request.target == "/common/rootdomain")
            return to_json(request.root_host);
         if (request.target == "/common/rootdomain.js")
         {
            auto js = "const rootdomain = '" + request.root_host + "';\n";
            js +=
                "function siblingUrl(contract, path) {\n"
                "    return location.protocol + '//' + (contract ? contract + '.' : '') +\n"
                "           rootdomain + ':' + location.port + '/' + (path || '');\n"
                "}\n";
            return rpc_reply_data{
                .contentType = "text/javascript",
                .reply       = {js.begin(), js.end()},
            };
         }
         if (request.target == "/common/rootdomain.mjs")
         {
            auto js = "export const rootdomain = '" + request.root_host + "';\n";
            js +=
                "export function siblingUrl(contract, path) {\n"
                "    return location.protocol + '//' + (contract ? contract + '.' : '') +\n"
                "           rootdomain + ':' + location.port + '/' + (path || '');\n"
                "}\n";
            return rpc_reply_data{
                .contentType = "text/javascript",
                .reply       = {js.begin(), js.end()},
            };
         }
      }

      if (request.method == "POST")
      {
         // TODO: move to an ABI wasm?
         if (request.target == "/common/pack/signed_transaction")
         {
            request.body.push_back(0);
            psio::json_token_stream jstream{request.body.data()};
            signed_transaction      trx;
            psio::from_json(trx, jstream);
            return rpc_reply_data{
                .contentType = "application/octet-stream",
                .reply       = psio::convert_to_frac(trx),
            };
         }
      }

      return std::nullopt;
   }  // common_sys::serveSys

   void common_sys::uploadSys(psio::const_view<std::string>       path,
                              psio::const_view<std::string>       contentType,
                              psio::const_view<std::vector<char>> content)
   {
      check(get_sender() == get_receiver(), "wrong sender");

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
      kv_put(row.key(get_receiver()), row);
   }

}  // namespace psibase

PSIBASE_DISPATCH(psibase::common_sys)
