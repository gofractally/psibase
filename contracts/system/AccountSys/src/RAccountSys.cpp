#include "contracts/system/RAccountSys.hpp"

#include <contracts/system/AccountSys.hpp>
#include <contracts/system/ProxySys.hpp>
#include <psibase/dispatch.hpp>
#include <psibase/nativeTables.hpp>
#include <psibase/serveContent.hpp>
#include <psibase/serveSimpleUI.hpp>
#include <psio/from_json.hpp>
#include <psio/to_json.hpp>

static constexpr bool enable_print = false;

using namespace psibase;
using Tables = psibase::ContractTables<psibase::WebContentTable>;

namespace system_contract
{
   std::optional<RpcReplyData> RAccountSys::serveSys(RpcRequestData request)
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
         // TODO: replace with GraphQL
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

      if (auto result = psibase::serveSimpleUI<AccountSys, false>(request))
         return result;
      if (auto result = psibase::serveContent(request, Tables{getReceiver()}))
         return result;
      return std::nullopt;
   }  // serveSys

   void RAccountSys::storeSys(std::string path, std::string contentType, std::vector<char> content)
   {
      psibase::check(getSender() == getReceiver(), "wrong sender");
      psibase::storeContent(std::move(path), std::move(contentType), std::move(content),
                            Tables{getReceiver()});
   }

}  // namespace system_contract

PSIBASE_DISPATCH(system_contract::RAccountSys)
