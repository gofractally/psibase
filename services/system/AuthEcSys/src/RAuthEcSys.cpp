#include "services/system/RAuthEcSys.hpp"

#include <psibase/dispatch.hpp>
#include <psibase/serveSimpleUI.hpp>
#include <services/system/AuthEcSys.hpp>
#include <services/system/ProxySys.hpp>

#include <string>
#include <string_view>

using namespace psibase;
using std::string;
using std::string_view;

namespace SystemService
{
   std::optional<HttpReply> RAuthEcSys::serveSys(HttpRequest request)
   {
      if (auto result = psibase::serveContent(request, Tables{getReceiver()}))
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
                            Tables{getReceiver()});
   }

   std::optional<HttpReply> RAuthEcSys::serveRestEndpoints(HttpRequest& request)
   {
      auto to_json = [](const auto& obj)
      {
         auto json = psio::convert_to_json(obj);
         return HttpReply{
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

            AuthEcSys::Tables db{AuthEcSys::service};
            auto              authIdx = db.open<AuthEcSys::AuthTable>().getIndex<1>();

            auto pubkey = publicKeyFromString(string_view{pubkeyParam});

            std::vector<AuthRecord> auths;
            for (auto itr = authIdx.lower_bound(pubkey); itr != authIdx.end(); ++itr)
            {
               auto obj = *itr;
               if (obj.pubkey != pubkey)
                  break;
               auths.push_back(obj);
            }

            return to_json(auths);
         }
      }

      if (request.target.starts_with("/account"))
      {
         auto accountParam = request.target.substr(string("/account/").size());

         check(accountParam.find('/') == string::npos, "invalid account name: " + accountParam);

         psibase::AccountNumber acc{accountParam};

         AuthEcSys::Tables db{AuthEcSys::service};
         auto account = db.open<AuthEcSys::AuthTable>().getIndex<0>().get(acc);

         return to_json(account.value_or(SystemService::AuthRecord()));
      }

      return std::nullopt;
   }

   // getKeys
}  // namespace SystemService

PSIBASE_DISPATCH(SystemService::RAuthEcSys)
