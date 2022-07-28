#include "contracts/system/RAuthEcSys.hpp"

#include <contracts/system/AuthEcSys.hpp>
#include <contracts/system/ProxySys.hpp>
#include <psibase/dispatch.hpp>
#include <psibase/serveContent.hpp>
#include <psibase/serveSimpleUI.hpp>

#include <string>
#include <string_view>

using namespace psibase;
using std::string;
using std::string_view;

namespace system_contract
{
   std::optional<RpcReplyData> RAuthEcSys::serveSys(RpcRequestData request)
   {
      if (auto result = psibase::serveContent(request, AuthEcSys::Tables{getReceiver()}))
         return result;

      if (auto result = servePackAction<AuthEcSys>(request))
         return result;

      if (auto result = _serveRestEndpoints(request))
         return result;

      if (auto result = psibase::serveSimpleUI<AuthEcSys, true>(request))
         return result;

      return std::nullopt;

   }  // serveSys

   void RAuthEcSys::storeSys(std::string path, std::string contentType, std::vector<char> content)
   {
      psibase::check(getSender() == getReceiver(), "wrong sender");
      psibase::storeContent(std::move(path), std::move(contentType), std::move(content),
                            AuthEcSys::Tables{getReceiver()});
   }

   std::optional<RpcReplyData> RAuthEcSys::_serveRestEndpoints(RpcRequestData& request)
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
         if (request.target.starts_with("/accwithkey"))
         {
            auto pubkeyParam = request.target.substr(string("/accwithkey/").size());

            check(pubkeyParam.find('/') == string::npos, "invalid public key: " + pubkeyParam);

            AuthEcSys::Tables db{AuthEcSys::contract};
            auto              authIdx = db.open<AuthEcSys::AuthTable_t>().getIndex<0>();
            check(authIdx.begin() != authIdx.end(), "No tokens");

            auto pubkey = publicKeyFromString(string_view{pubkeyParam});

            std::vector<AccountNumber> accounts;
            for (auto itr = authIdx.begin(); itr != authIdx.end(); ++itr)
            {
               if ((*itr).pubkey == pubkey)
               {
                  accounts.push_back((*itr).account);
               }
            }

            return to_json(accounts);
         }
      }

      return std::nullopt;
   }

   // getKeys
}  // namespace system_contract

PSIBASE_DISPATCH(system_contract::RAuthEcSys)
