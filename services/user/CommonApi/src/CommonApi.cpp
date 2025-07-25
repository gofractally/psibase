#include <iomanip>

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

   std::string getCookieExpiration()
   {
      static constexpr int EXPIRATION_IN_DAYS = 30;
      
      // Get current chain time and add EXPIRATION_IN_DAYS days
      auto in30Days =
          std::chrono::time_point_cast<psibase::Seconds>(to<Transact>().currentBlock().time) +
          std::chrono::duration_cast<psibase::Seconds>(std::chrono::days(EXPIRATION_IN_DAYS));
      
      // Convert to time_t for gmtime
      auto  timeT = std::chrono::system_clock::to_time_t(in30Days);
      auto* gmt   = std::gmtime(&timeT);
      
      // Format as RFC 1123 GMT string
      std::ostringstream oss;
      oss << std::put_time(gmt, "%a, %d %b %Y %H:%M:%S GMT");
      return oss.str();
   }
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
         if (request.target == "/common/set-auth-cookie")
         {
            request.body.push_back(0);
            psio::json_token_stream jstream{request.body.data()};
            auto                    params = psio::from_json<cookie_data>(jstream);

            std::vector<HttpHeader> headers;
            bool                    isDevChain = psibase::isDevChain(request);
            std::string             cookieName = "__Host-SESSION";
            
            std::string cookieAttribs =
                "Path=/; HttpOnly; Secure; SameSite=Strict; Expires=" + getCookieExpiration();
            if (isDevChain)
               cookieName = "SESSION";

            std::string cookieValue = cookieName + "=" + params.accessToken + "; " + cookieAttribs;
            headers.push_back({"Set-Cookie", cookieValue});

            return HttpReply{.status      = HttpStatus::ok,
                             .contentType = "application/json",
                             .body        = {},
                             .headers     = headers};
         }
      }
      return std::nullopt;
   }  // CommonApi::serveSys

}  // namespace SystemService

PSIBASE_DISPATCH(SystemService::CommonApi)
