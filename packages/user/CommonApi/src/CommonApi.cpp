#include "services/system/CommonApi.hpp"

#include <psibase/dispatch.hpp>
#include <psibase/nativeTables.hpp>
#include <psio/to_json.hpp>
#include <services/system/HttpServer.hpp>
#include <services/system/Transact.hpp>

static constexpr bool enable_print = false;

using namespace psibase;

namespace SystemService
{
   struct cookie_data
   {
      std::string accessToken;
   };
   PSIO_REFLECT(cookie_data, accessToken);

   int getCookieMaxAge()
   {
      static constexpr int EXPIRATION_IN_DAYS = 30;
      return EXPIRATION_IN_DAYS * 24 * 60 * 60;
   }
   std::optional<HttpReply> CommonApi::serveSys(HttpRequest request)
   {
      auto to_json = [](const auto& obj)
      {
         auto json = psio::convert_to_json(obj);
         return HttpReply{
             .contentType = "application/json",
             .body        = {json.begin(), json.end()},
             .headers     = allowCors(),
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
               serviceName = HttpServer::homepageService.str();
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
                .headers     = allowCors(),
            };
         }
         if (request.target == "/common/chainid")
         {
            return to_json(getStatus().chainId);
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
                .headers     = allowCors(),
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
                .headers     = allowCors(),
            };
         }
         if (request.target == "/common/set-auth-cookie")
         {
            request.body.push_back(0);
            psio::json_token_stream jstream{request.body.data()};
            auto                    params = psio::from_json<cookie_data>(jstream);

            std::vector<HttpHeader> headers     = allowCors();
            bool                    isLocalhost = psibase::isLocalhost(request);
            std::string             cookieName  = "__Host-SESSION";

            std::string cookieAttribs = "Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=" +
                                        std::to_string(getCookieMaxAge());
            if (isLocalhost)
               cookieName = "SESSION";

            std::string cookieValue = cookieName + "=" + params.accessToken + "; " + cookieAttribs;
            headers.push_back({"Set-Cookie", cookieValue});

            return HttpReply{.status      = HttpStatus::ok,
                             .contentType = "text/plain",
                             .body        = {},
                             .headers     = headers};
         }
      }
      return std::nullopt;
   }  // CommonApi::serveSys

}  // namespace SystemService

PSIBASE_DISPATCH(SystemService::CommonApi)
