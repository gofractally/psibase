#include "contracts/user/blocklog_sys.hpp"

#include <contracts/system/proxy_sys.hpp>
#include <psibase/dispatch.hpp>

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

namespace system_contract
{
   rpc_reply_data blocklog_sys::serveSys(rpc_request_data request)
   {
      if (request.method == "GET")
      {
         auto content = kv_get<WebContentRow>(webContentKey(get_receiver(), request.target));
         if (!!content)
         {
            return {
                .contentType = content->contentType,
                .reply       = content->content,
            };
         }
      }

      abort_message_str("not found");
   }  // blocklog_sys::proxy_sys

   void blocklog_sys::uploadSys(psio::const_view<std::string>       path,
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

}  // namespace system_contract

PSIBASE_DISPATCH(system_contract::blocklog_sys)
