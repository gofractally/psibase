#include "services/system/CommonSys.hpp"

#include <psibase/dispatch.hpp>
#include <psibase/nativeTables.hpp>
#include <psibase/serveContent.hpp>
#include <psio/to_json.hpp>
#include <services/system/ProxySys.hpp>
#include <services/system/TransactionSys.hpp>

static constexpr bool enable_print = false;

using namespace psibase;
using Tables = psibase::ServiceTables<psibase::WebContentTable>;

namespace SystemService
{
   static constexpr std::pair<const char*, const char*> commonResMap[]{
       {"/", "/ui/common.index.html"}};

   std::optional<HttpReply> CommonSys::serveSys(HttpRequest request)
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
         if (request.target.starts_with("/applet/"))
         {
            // All requests to load a specific applet will return the root index from common-sys.
            // Then common-sys will read the URL bar, detect that an applet is being loaded,
            // and request the applet to load inside an iframe.
            request.target = "/";
         }
         if (request.target == "/common/thisservice")
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
         if (request.target == "/common/tapos/head")
         {
            auto [index, suffix] = headTapos();
            auto json            = "{\"refBlockIndex\":" + std::to_string(index) +
                        ",\"refBlockSuffix\":" + std::to_string(suffix) + "}";
            return HttpReply{
                .contentType = "application/json",
                .body        = {json.begin(), json.end()},
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
            return HttpReply{
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
            return HttpReply{
                .contentType = "application/octet-stream",
                .body        = psio::convert_to_frac(trx),
            };
         }
      }

      if (auto result = psibase::serveContent(request, Tables{getReceiver()}))
      {
         result->headers = {
             {"Content-Security-Policy", "frame-ancestors 'none';"},
         };
         return result;
      }
      return std::nullopt;
   }  // CommonSys::serveSys

   void CommonSys::storeSys(std::string path, std::string contentType, std::vector<char> content)
   {
      psibase::check(getSender() == getReceiver(), "wrong sender");
      psibase::storeContent(std::move(path), std::move(contentType), std::move(content),
                            Tables{getReceiver()});
   }

   std::optional<HttpReply> CommonSys::serveCommon(HttpRequest request)
   {
      if (request.method == "GET")
      {
         for (auto [target, replacement] : commonResMap)
         {
            if (target == request.target)
            {
               auto index = ServiceTables<WebContentTable>{getReceiver()}
                                .open<WebContentTable>()
                                .getIndex<0>();
               if (auto content = index.get(std::string(replacement)))
               {
                  return HttpReply{
                      .contentType = content->contentType,
                      .body        = content->content,
                  };
               }
            }
         }
      }
      return std::nullopt;
   }

}  // namespace SystemService

PSIBASE_DISPATCH(SystemService::CommonSys)
