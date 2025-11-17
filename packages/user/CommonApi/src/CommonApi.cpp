#include "services/system/CommonApi.hpp"

#include <chrono>
#include <psibase/dispatch.hpp>
#include <psibase/nativeTables.hpp>
#include <psio/to_json.hpp>
#include <services/system/HttpServer.hpp>
#include <services/system/Transact.hpp>

static constexpr bool enable_print = false;

using namespace psibase;

namespace SystemService
{
   struct TokenData
   {
      std::string accessToken;
   };
   PSIO_REFLECT(TokenData, accessToken);

   namespace
   {
      constexpr auto cookieMaxAge =
          std::chrono::duration_cast<std::chrono::seconds>(std::chrono::days(30)).count();

      template <typename T>
      T extractData(HttpRequest& request)
      {
         request.body.push_back(0);
         psio::json_token_stream jstream{request.body.data()};
         auto                    result = psio::from_json<T>(jstream);
         request.body.pop_back();
         return result;
      }

      HttpHeader authCookie(const HttpRequest& req, const std::string& accessToken, int maxAge)
      {
         bool        isLocalhost = psibase::isLocalhost(req);
         std::string cookieName  = isLocalhost ? "SESSION" : "__Host-SESSION";

         std::string cookieAttribs;
         cookieAttribs += "Path=/; ";
         cookieAttribs += "HttpOnly; ";
         cookieAttribs += "SameSite=Strict; ";
         cookieAttribs += "Max-Age=" + std::to_string(maxAge);
         if (!isLocalhost)
         {
            cookieAttribs += "; Secure; ";
         }

         std::string cookieValue = cookieName + "=" + accessToken + "; " + cookieAttribs;
         return HttpHeader{"Set-Cookie", cookieValue};
      }

      HttpHeader allowCredentials()
      {
         return HttpHeader{"Access-Control-Allow-Credentials", "true"};
      }

      void reflectRequestedHeaders(std::vector<HttpHeader>& headers, const HttpRequest& req)
      {
         if (auto requested = req.getHeader("access-control-request-headers"); requested)
         {
            for (auto& h : headers)
            {
               if (h.name == "Access-Control-Allow-Headers")
               {
                  h.value = *requested;
                  break;
               }
            }
         }
      }

      std::vector<HttpHeader> allowCorsFrom(const HttpRequest& req, AccountNumber subdomain)
      {
         bool hostIsSubdomain = to<HttpServer>().rootHost(req.host) != req.host;
         return allowCors(req, subdomain, hostIsSubdomain);
      }
   }  // namespace

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
            auto        rootHost = to<HttpServer>().rootHost(request.host);
            std::string serviceName;
            if (request.host.size() > rootHost.size() + 1 && request.host.ends_with(rootHost) &&
                request.host[request.host.size() - rootHost.size() - 1] == '.')
               serviceName.assign(request.host.begin(), request.host.end() - rootHost.size() - 1);
            else
               serviceName = HttpServer::homepageService.str();
            return to_json(serviceName);
         }
         if (request.target == "/common/rootdomain")
            return to_json(to<HttpServer>().rootHost(request.host));
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

      if (request.method == "OPTIONS")
      {
         if (request.target == "/common/set-auth-cookie" ||
             request.target == "/common/remove-auth-cookie")
         {
            auto headers = allowCorsFrom(request, "supervisor"_a);
            headers.push_back(allowCredentials());
            reflectRequestedHeaders(headers, request);

            return HttpReply{.headers = headers};
         }
      }

      if (request.method == "POST")
      {
         if (request.target == "/common/pack/Transaction")
         {
            return HttpReply{
                .contentType = "application/octet-stream",
                .body        = psio::convert_to_frac(extractData<Transaction>(request)),
                .headers     = allowCors(),
            };
         }
         if (request.target == "/common/pack/SignedTransaction")
         {
            return HttpReply{
                .contentType = "application/octet-stream",
                .body        = psio::convert_to_frac(extractData<SignedTransaction>(request)),
                .headers     = allowCors(),
            };
         }
         if (request.target == "/common/set-auth-cookie")
         {
            auto data = extractData<TokenData>(request);

            auto headers = allowCorsFrom(request, "supervisor"_a);
            headers.push_back(allowCredentials());
            headers.push_back(authCookie(request, data.accessToken, cookieMaxAge));

            return HttpReply{.status      = HttpStatus::ok,
                             .contentType = "text/plain",
                             .body        = {},
                             .headers     = headers};
         }
         if (request.target == "/common/remove-auth-cookie")
         {
            auto headers = allowCorsFrom(request, "supervisor"_a);
            headers.push_back(allowCredentials());
            headers.push_back(authCookie(request, "", 0));

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
