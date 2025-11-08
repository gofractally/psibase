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
   struct TokenData
   {
      std::string accessToken;
   };
   PSIO_REFLECT(TokenData, accessToken);

   namespace
   {
      int getCookieMaxAge()
      {
         static constexpr int EXPIRATION_IN_DAYS = 30;
         return EXPIRATION_IN_DAYS * 24 * 60 * 60;
      }

      template <typename T>
      T extractData(HttpRequest& request)
      {
         request.body.push_back(0);
         psio::json_token_stream jstream{request.body.data()};
         return psio::from_json<T>(jstream);
      }

      std::vector<HttpHeader> getAuthCookieHeaders(const HttpRequest& req,
                                                   const std::string& accessToken,
                                                   int                maxAge)
      {
         bool hostIsSubdomain = to<HttpServer>().rootHost(req.host) != req.host;
         auto headers         = allowCors(req, "supervisor"_a, hostIsSubdomain);

         // Needed for browsers to allow cross-domain calls that set cookies (along with non-* CORS headers)
         headers.push_back({"Access-Control-Allow-Credentials", "true"});

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
         headers.push_back({"Set-Cookie", cookieValue});
         return headers;
      }

      std::vector<HttpHeader> getAuthPreflightHeaders(const HttpRequest& req)
      {
         bool hostIsSubdomain = to<HttpServer>().rootHost(req.host) != req.host;
         auto headers         = allowCors(req, "supervisor"_a, hostIsSubdomain);

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

         headers.push_back({"Access-Control-Allow-Credentials", "true"});
         return headers;
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
            psibase::writeConsole("[CommonApi] thisservice: entry, host=" + request.host + "\n");
            auto rootHost = to<HttpServer>().rootHost(request.host);
            psibase::writeConsole("[CommonApi] thisservice: rootHost=" + rootHost + "\n");
            std::string serviceName;
            if (request.host.size() > rootHost.size() + 1 && request.host.ends_with(rootHost) &&
                request.host[request.host.size() - rootHost.size() - 1] == '.')
            {
               serviceName.assign(request.host.begin(), request.host.end() - rootHost.size() - 1);
               psibase::writeConsole(
                   "[CommonApi] thisservice: extracted serviceName=" + serviceName + "\n");
            }
            else
            {
               serviceName = HttpServer::homepageService.str();
               psibase::writeConsole(
                   "[CommonApi] thisservice: using homepageService=" + serviceName + "\n");
            }
            psibase::writeConsole("[CommonApi] thisservice: returning serviceName=" + serviceName +
                                  "\n");
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
            return HttpReply{.headers = getAuthPreflightHeaders(request)};
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
            auto token_data = extractData<TokenData>(request);
            auto headers = getAuthCookieHeaders(request, token_data.accessToken, getCookieMaxAge());

            return HttpReply{.status      = HttpStatus::ok,
                             .contentType = "text/plain",
                             .body        = {},
                             .headers     = headers};
         }
         if (request.target == "/common/remove-auth-cookie")
         {
            return HttpReply{.status      = HttpStatus::ok,
                             .contentType = "text/plain",
                             .body        = {},
                             .headers     = getAuthCookieHeaders(request, "", 0)};
         }
      }
      return std::nullopt;
   }  // CommonApi::serveSys

}  // namespace SystemService

PSIBASE_DISPATCH(SystemService::CommonApi)
