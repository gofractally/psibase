#include "contracts/system/rpc_roothost_sys.hpp"

#include <contracts/system/account_sys.hpp>
#include <contracts/system/rpc_sys.hpp>
#include <psibase/dispatch.hpp>
#include <psibase/native_tables.hpp>

static constexpr bool enable_print = false;

using table_num = uint32_t;

static constexpr table_num web_content_table = 1;

inline auto web_content_key(psibase::account_num this_contract, std::string_view path)
{
   return std::tuple{this_contract, web_content_table, path};
}
struct web_content_row
{
   std::string       path         = {};
   std::string       content_type = {};
   std::vector<char> content      = {};

   auto key(psibase::account_num this_contract) { return web_content_key(this_contract, path); }
};
EOSIO_REFLECT(web_content_row, path, content_type, content)

namespace psibase
{
   rpc_reply_data rpc_roothost_sys::rpc_sys(rpc_request_data request)
   {
      auto to_json = [](const auto& obj)
      {
         auto json = eosio::convert_to_json(obj);
         return rpc_reply_data{
             .content_type = "application/json",
             .reply        = {json.begin(), json.end()},
         };
      };

      if (request.method == "GET")
      {
         auto content = kv_get<web_content_row>(web_content_key(get_receiver(), request.target));
         if (!!content)
         {
            return {
                .content_type = content->content_type,
                .reply        = content->content,
            };
         }

         if (request.target == "/roothost/roothost")
            return to_json(request.root_host);
         if (request.target == "/roothost/roothost.js")
         {
            auto js = "const roothost = '" + request.root_host + "';\n";
            js +=
                "function roothostUrl(contract, path) {\n"
                "    return location.protocol + '//' + (contract ? contract + '.' : '') +\n"
                "           roothost + ':' + location.port + '/' + (path || '');\n"
                "}\n";
            return rpc_reply_data{
                .content_type = "text/javascript",
                .reply        = {js.begin(), js.end()},
            };
         }
      }

      abort_message_str("not found");
   }  // rpc_roothost_sys::rpc_sys

   void rpc_roothost_sys::upload_rpc_sys(psio::const_view<std::string>       path,
                                         psio::const_view<std::string>       content_type,
                                         psio::const_view<std::vector<char>> content)
   {
      check(get_sender() == get_receiver(), "wrong sender");

      // TODO
      auto              size = content.size();
      std::vector<char> c(size);
      for (size_t i = 0; i < size; ++i)
         c[i] = content[i];

      // TODO: avoid copies before pack
      web_content_row row{
          .path         = path,
          .content_type = content_type,
          .content      = std::move(c),
      };
      kv_put(row.key(get_receiver()), row);
   }

}  // namespace psibase

PSIBASE_DISPATCH(psibase::rpc_roothost_sys)
