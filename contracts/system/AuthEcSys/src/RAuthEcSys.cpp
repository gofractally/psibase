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

      if (auto result = serveRestEndpoints(request))
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

   std::optional<RpcReplyData> RAuthEcSys::serveRestEndpoints(RpcRequestData& request)
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
            auto              authIdx = db.open<AuthEcSys::AuthTable>().getIndex<1>();

            auto pubkey = publicKeyFromString(string_view{pubkeyParam});

            std::vector<AuthRecord> auths;
            for (auto itr = authIdx.lower_bound(pubkey); itr != authIdx.upper_bound(pubkey); ++itr)
            {
               auths.push_back((*itr));
            }

            return to_json(auths);
         }
      }

      return std::nullopt;
   }

   // getKeys
}  // namespace system_contract

PSIBASE_DISPATCH(system_contract::RAuthEcSys)
