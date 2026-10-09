#include "services/system/CommonApi.hpp"

#include <psibase/check.hpp>
#include <psibase/dispatch.hpp>
#include <psibase/nativeTables.hpp>
#include <psio/to_json.hpp>
#include <services/system/HttpServer.hpp>
#include <services/system/Transact.hpp>

#include <algorithm>
#include <string_view>

static constexpr bool enable_print = false;

using namespace psibase;

namespace SystemService
{
   struct CookieData
   {
      std::string name;
      std::string value;
      int         maxAge   = 0;
      bool        httpOnly = false;
   };
   PSIO_REFLECT(CookieData, name, value, maxAge, httpOnly);

   namespace
   {
      template <typename T>
      T extractData(HttpRequest& request)
      {
         request.body.push_back(0);
         psio::json_token_stream jstream{request.body.data()};
         auto                    result = psio::from_json<T>(jstream);
         request.body.pop_back();
         return result;
      }

      bool isAllowedChar(char ch, std::string_view excluded)
      {
         auto c = static_cast<unsigned char>(ch);
         return c >= 0x21 && c <= 0x7E && excluded.find(ch) == std::string_view::npos;
      }

      bool isTokenChar(char ch)
      {
         return isAllowedChar(ch, "()<>@,;:\\\"/[]?={} \t");
      }

      bool isCookieOctet(char ch)
      {
         return isAllowedChar(ch, "\",;\\");
      }

      bool isValidCookieName(std::string_view name)
      {
         return !name.empty() && std::ranges::all_of(name, isTokenChar);
      }

      bool isValidCookieValue(std::string_view value)
      {
         if (value.size() >= 2 && value.front() == '"' && value.back() == '"')
            value = value.substr(1, value.size() - 2);
         return std::ranges::all_of(value, isCookieOctet);
      }

      HttpHeader setCookieHeader(const std::string& name,
                                 const std::string& value,
                                 int                maxAge,
                                 bool               httpOnly)
      {
         std::string cookieName = "__Host-" + name;

         std::string cookieAttribs;
         cookieAttribs += "Path=/; ";
         cookieAttribs += "SameSite=Strict; ";
         cookieAttribs += "Secure; ";
         cookieAttribs += "Max-Age=" + std::to_string(maxAge);
         cookieAttribs += "; ";
         if (httpOnly)
            cookieAttribs += "HttpOnly; ";

         std::string cookieValue = cookieName + "=" + value + "; " + cookieAttribs;
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
            {
               abortMessage("Invalid host");
            }
            return to_json(serviceName);
         }
         if (request.target == "/common/rootdomain")
            return to_json(to<HttpServer>().rootHost(request.host));
         if (request.target == "/common/tapos/head")
         {
            auto [index, suffix] = to<Transact>().headTapos();
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
         if (request.target == "/common/set-host-cookie")
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
         if (request.target == "/common/set-host-cookie")
         {
            auto headers = allowCorsFrom(request, "supervisor"_a);
            if (headers.empty())
            {
               return HttpReply{.status      = HttpStatus::forbidden,
                                .contentType = "text/plain",
                                .body        = {},
                                .headers     = {}};
            }
            headers.push_back(allowCredentials());

            auto data = extractData<CookieData>(request);

            // cookie-name and cookie-value per RFC 6265; maxAge must be non-negative.
            if (!isValidCookieName(data.name) || !isValidCookieValue(data.value) || data.maxAge < 0)
            {
               return HttpReply{.status      = HttpStatus::badRequest,
                                .contentType = "text/plain",
                                .body        = {},
                                .headers     = headers};
            }

            headers.push_back(
                setCookieHeader(data.name, data.value, data.maxAge, data.httpOnly));

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
