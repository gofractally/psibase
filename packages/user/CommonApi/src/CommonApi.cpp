#include "services/system/CommonApi.hpp"

#include <psibase/check.hpp>
#include <psibase/dispatch.hpp>
#include <psibase/nativeTables.hpp>
#include <psio/json.hpp>
#include <services/local/XHttp.hpp>
#include <services/system/Transact.hpp>

#include <algorithm>
#include <string_view>

static constexpr bool enable_print = false;

using namespace psibase;
using namespace LocalService;

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
         return psio::from_ijson<T>(request.body);
      }

      bool isAllowedChar(char ch, std::string_view excluded)
      {
         auto c = static_cast<unsigned char>(ch);
         return c >= 0x21 && c <= 0x7E && excluded.find(ch) == std::string_view::npos;
      }

      bool isTokenChar(char ch)
      {
         return isAllowedChar(ch, "()<>@,;:\\\"/[]?={}");
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
         cookieAttribs += "; Path=/";
         cookieAttribs += "; SameSite=Strict";
         cookieAttribs += "; Secure";
         cookieAttribs += "; Max-Age=" + std::to_string(maxAge);
         if (httpOnly)
            cookieAttribs += "; HttpOnly";

         std::string cookieValue = cookieName + "=" + value + cookieAttribs;
         return HttpHeader{"Set-Cookie", cookieValue};
      }

      // application/x-www-form-urlencoded value
      std::string formDecode(std::string_view in)
      {
         auto hex = [](char c) -> int
         {
            if (c >= '0' && c <= '9')
               return c - '0';
            if (c >= 'a' && c <= 'f')
               return c - 'a' + 10;
            if (c >= 'A' && c <= 'F')
               return c - 'A' + 10;
            return -1;
         };
         std::string out;
         for (std::size_t i = 0; i < in.size(); ++i)
         {
            if (in[i] == '+')
               out += ' ';
            else if (in[i] == '%' && i + 2 < in.size() && hex(in[i + 1]) >= 0 &&
                     hex(in[i + 2]) >= 0)
            {
               out += static_cast<char>(hex(in[i + 1]) * 16 + hex(in[i + 2]));
               i += 2;
            }
            else
               out += in[i];
         }
         return out;
      }

      std::optional<std::string> formField(std::string_view body, std::string_view name)
      {
         while (!body.empty())
         {
            auto item = body.substr(0, body.find('&'));
            body.remove_prefix(std::min(body.size(), item.size() + 1));
            auto eq = item.find('=');
            if (eq != std::string_view::npos && item.substr(0, eq) == name)
               return formDecode(item.substr(eq + 1));
         }
         return std::nullopt;
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
         bool hostIsSubdomain = to<XHttp>().rootHost(req.host) != req.host;
         return allowCors(req, subdomain, hostIsSubdomain);
      }

      // Empty unless the request's Origin is the subdomain.
      std::vector<HttpHeader> allowCredentialedCorsFrom(const HttpRequest& req,
                                                        AccountNumber      subdomain)
      {
         auto headers = allowCorsFrom(req, subdomain);
         if (!headers.empty())
            headers.push_back(allowCredentials());
         return headers;
      }
   }  // namespace

   std::optional<HttpReply> CommonApi::serveSys(HttpRequest request)
   {
      auto to_json = [](const auto& obj)
      {
         auto json = psio::to_ijson(obj);
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
            auto        rootHost = to<XHttp>().rootHost(request.host);
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
            return to_json(to<XHttp>().rootHost(request.host));
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
            auto headers = allowCredentialedCorsFrom(request, "supervisor"_a);
            reflectRequestedHeaders(headers, request);

            return HttpReply{.headers = headers};
         }
      }

      if (request.method == "POST")
      {
         auto requireJson = [&] -> std::optional<HttpReply>
         {
            if (request.contentType != "application/json")
            {
               auto headers = allowCors();
               headers.push_back({"Allow", "application/json"});
               auto msg = std::string_view("Content-Type must be application/json");
               return HttpReply{
                   .status      = HttpStatus::unsupportedMediaType,
                   .contentType = "text/html",
                   .body        = {msg.begin(), msg.end()},
                   .headers     = std::move(headers),
               };
            }
            return {};
         };
         if (request.target == "/common/pack/Transaction")
         {
            if (auto result = requireJson())
               return result;
            return HttpReply{
                .contentType = "application/octet-stream",
                .body        = psio::to_pssz(extractData<Transaction>(request)),
                .headers     = allowCors(),
            };
         }
         if (request.target == "/common/pack/SignedTransaction")
         {
            if (auto result = requireJson())
               return result;
            return HttpReply{
                .contentType = "application/octet-stream",
                .body        = psio::to_pssz(extractData<SignedTransaction>(request)),
                .headers     = allowCors(),
            };
         }
         // The last step of sign-in. The supervisor's sign-in page sends the
         // browser here with a top-level form post, so the session cookie is
         // set first-party and every browser keeps it; the reply returns the
         // browser to the page it asked for.
         //
         // Only the supervisor origin may do this. Any other page posting
         // here could plant its own session in the visitor's browser.
         if (request.target == "/common/accept-session")
         {
            auto plain = [](HttpStatus status, std::string_view msg)
            {
               return HttpReply{.status      = status,
                                .contentType = "text/plain",
                                .body        = std::vector(msg.begin(), msg.end()),
                                .headers     = {{"Cache-Control", "no-store"}}};
            };
            if (allowCorsFrom(request, "supervisor"_a).empty())
            {
               // Never a dead end: the visitor can carry on from the app.
               std::string_view page =
                   "<!doctype html><html><head><meta charset=\"utf-8\">"
                   "<title>Sign-in not completed</title></head>"
                   "<body style=\"font:16px system-ui;max-width:28em;margin:15vh auto;"
                   "padding:0 20px\"><h2>Sign-in wasn't completed</h2>"
                   "<p>This step has to come straight from the sign-in page.</p>"
                   "<p><a href=\"/\">Continue to the app</a></p></body></html>";
               return HttpReply{.status      = HttpStatus::forbidden,
                                .contentType = "text/html",
                                .body        = std::vector(page.begin(), page.end()),
                                .headers     = {{"Cache-Control", "no-store"}}};
            }
            if (request.contentType != "application/x-www-form-urlencoded")
               return plain(HttpStatus::unsupportedMediaType, "Expected a form post");

            std::string_view body{request.body.data(), request.body.size()};
            auto             token  = formField(body, "token");
            auto             path   = formField(body, "path").value_or("/");
            auto             maxAge = formField(body, "maxAge").value_or("0");
            int              age    = 0;
            for (char c : maxAge)
            {
               if (c < '0' || c > '9' || age > 100'000'000)
                  return plain(HttpStatus::badRequest, "Bad maxAge");
               age = age * 10 + (c - '0');
            }
            // The destination stays on this host.
            if (!token || !isValidCookieValue(*token) || path.empty() || path[0] != '/' ||
                path.starts_with("//") || path.find('\\') != std::string::npos ||
                path.find_first_of("\r\n") != std::string::npos)
               return plain(HttpStatus::badRequest, "Bad sign-in request");

            // Not a redirect: the cookie is SameSite=Strict, so it is only
            // sent on a navigation this host starts itself. This page is
            // served by this host and continues to the destination.
            std::string escaped;
            for (char c : path)
            {
               switch (c)
               {
                  case '&':
                     escaped += "&amp;";
                     break;
                  case '"':
                     escaped += "&quot;";
                     break;
                  case '\'':
                     escaped += "&#39;";
                     break;
                  case '<':
                     escaped += "&lt;";
                     break;
                  case '>':
                     escaped += "&gt;";
                     break;
                  default:
                     escaped += c;
               }
            }
            std::string page =
                "<!doctype html><html><head><meta charset=\"utf-8\">"
                "<meta name=\"referrer\" content=\"no-referrer\">"
                "<meta http-equiv=\"refresh\" content=\"0;url=" +
                escaped +
                "\"><title>Signing in</title></head><body><a href=\"" + escaped +
                "\">Continue</a></body></html>";
            // A second cookie, for the whole network's hosts, says who to
            // bill when a page of this app queries another app's host. Apps
            // never see it and nothing treats it as the user speaking.
            std::string root{to<XHttp>().rootHost(request.host)};
            root = root.substr(0, root.find(':'));
            HttpHeader visitor{"Set-Cookie",
                               "__Secure-VISITOR=" + *token + "; Domain=" + root +
                                   "; Path=/; SameSite=Lax; Secure; HttpOnly; Max-Age=" +
                                   std::to_string(age)};
            HttpReply reply{
                .status      = HttpStatus::ok,
                .contentType = "text/html",
                .body        = std::vector(page.begin(), page.end()),
                .headers     = {std::move(visitor),
                                {"Cache-Control", "no-store"},
                                {"Content-Security-Policy",
                                 "default-src 'none'; base-uri 'none'; form-action 'none'"}}};
            // "visitorOnly": this host already holds an account's session,
            // set by the supervisor when it signed the account in. Only the
            // billing identity is refreshed; the session is left alone.
            if (formField(body, "visitorOnly").value_or("") != "1")
               reply.headers.push_back(setCookieHeader("SESSION", *token, age, true));
            return reply;
         }
         if (request.target == "/common/end-session")
         {
            // Signing out: the supervisor asks this host to drop its session
            // and the network-wide billing identity, which only a host can
            // do because scripts cannot see either cookie. No body, so no
            // preflight; only the supervisor's page may ask.
            auto        headers = allowCredentialedCorsFrom(request, "supervisor"_a);
            std::string root{to<XHttp>().rootHost(request.host)};
            root = root.substr(0, root.find(':'));
            headers.push_back(setCookieHeader("SESSION", "", 0, true));
            headers.push_back({"Set-Cookie", "__Secure-VISITOR=; Domain=" + root +
                                                 "; Path=/; SameSite=Lax; Secure; HttpOnly; "
                                                 "Max-Age=0"});
            headers.push_back({"Cache-Control", "no-store"});
            return HttpReply{.status      = HttpStatus::ok,
                             .contentType = "text/plain",
                             .body        = {},
                             .headers     = std::move(headers)};
         }
         if (request.target == "/common/set-host-cookie")
         {
            if (auto result = requireJson())
               return result;

            auto headers = allowCredentialedCorsFrom(request, "supervisor"_a);

            auto data = extractData<CookieData>(request);

            // cookie-name and cookie-value per RFC 6265; maxAge must be non-negative.
            if (!isValidCookieName(data.name) || !isValidCookieValue(data.value) || data.maxAge < 0)
            {
               return HttpReply{.status      = HttpStatus::badRequest,
                                .contentType = "text/plain",
                                .body        = {},
                                .headers     = headers};
            }

            headers.push_back(setCookieHeader(data.name, data.value, data.maxAge, data.httpOnly));

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
