#include "services/system/CommonApi.hpp"

#include <psibase/dispatch.hpp>
#include <psibase/nativeTables.hpp>
#include <psibase/serveContent.hpp>
#include <psio/to_json.hpp>
#include <services/system/HttpServer.hpp>
#include <services/system/Transact.hpp>

static constexpr bool enable_print = false;

using namespace psibase;
using Tables = psibase::ServiceTables<psibase::WebContentTable>;

namespace SystemService
{
   std::optional<HttpReply> CommonApi::serveSys(HttpRequest request)
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
         if (request.target == "/common/thisservice")
         {
            std::string serviceName;
            if (request.host.size() > request.rootHost.size() + 1 &&
                request.host.ends_with(request.rootHost) &&
                request.host[request.host.size() - request.rootHost.size() - 1] == '.')
               serviceName.assign(request.host.begin(),
                                  request.host.end() - request.rootHost.size() - 1);
            else
               serviceName = "common-api";
            return to_json(serviceName);
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
   }  // CommonApi::serveSys

   void CommonApi::storeSys(std::string path, std::string contentType, std::vector<char> content)
   {
      psibase::check(getSender() == getReceiver(), "wrong sender");
      psibase::storeContent(std::move(path), std::move(contentType), std::move(content),
                            Tables{getReceiver()});
   }

}  // namespace SystemService

PSIBASE_DISPATCH(SystemService::CommonApi)
