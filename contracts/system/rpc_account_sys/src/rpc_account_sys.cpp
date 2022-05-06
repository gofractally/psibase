#include "contracts/system/rpc_account_sys.hpp"

#include <contracts/system/account_sys.hpp>
#include <contracts/system/proxy_sys.hpp>
#include <psibase/SimpleUI.hpp>
#include <psibase/dispatch.hpp>
#include <psibase/nativeTables.hpp>
#include <psio/from_json.hpp>
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

namespace system_contract
{
   std::optional<rpc_reply_data> rpc_account_sys::serveSys(rpc_request_data request)
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
         auto content = kvGet<WebContentRow>(webContentKey(get_receiver(), request.target));
         if (!!content)
         {
            return rpc_reply_data{
                .contentType = content->contentType,
                .reply       = content->content,
            };
         }

         if (request.target == "/accounts")
         {
            std::vector<AccountRow> rows;
            auto                    key     = psio::convert_to_key(accountKey({}));
            auto                    keySize = sizeof(accountTable);
            while (true)
            {
               auto raw = kvGreaterEqualRaw(AccountRow::db, key, keySize);
               if (!raw)
                  break;
               auto acc = psio::convert_from_frac<AccountRow>(*raw);
               key      = getKey();
               key.push_back(0);
               rows.push_back(std::move(acc));
            }
            return to_json(rows);
         }
      }

      return psibase::serveSimpleUI<account_sys_iface, false>(request);
   }  // serveSys

   void rpc_account_sys::uploadSys(psio::const_view<std::string>       path,
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
      kvPut(row.key(get_receiver()), row);
   }  // uploadSys

}  // namespace system_contract

PSIBASE_DISPATCH(system_contract::rpc_account_sys)
