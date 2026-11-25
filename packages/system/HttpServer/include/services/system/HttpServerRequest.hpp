#pragma once
#include <psibase/Rpc.hpp>
#include <algorithm>

namespace SystemService::http_detail
{
   /// Authenticate the original request first, then remove every bearer secret
   /// before forwarding it to any application RPC or static server. Cookie names
   /// are case-sensitive: preserve ordinary application cookies such as session.
   inline void stripAuthenticationHeaders(psibase::HttpRequest& request)
   {
      request.removeCookies([](std::string_view name)
      {
         // Whitespace before '=' is malformed, but must not hide a sensitive
         // name from sanitization if a preceding Authorization header allowed
         // authentication without parsing the Cookie field.
         auto last = name.find_last_not_of(" \t");
         name = last == std::string_view::npos ? std::string_view{} : name.substr(0, last + 1);
         return name == "__Host-SESSION" || name == "__HOST-SESSION" || name == "SESSION";
      });
      std::erase_if(request.headers,
                    [](const auto& header) { return header.matches("authorization"); });
   }

   /// Authorization is a CORS non-wildcard request header: '*' alone never
   /// authorizes it. Generic public preflight remains non-credentialed.
   inline std::vector<psibase::HttpHeader> defaultPreflightHeaders()
   {
      auto headers = psibase::allowCors();
      for (auto& header : headers)
         if (header.matches("access-control-allow-headers"))
            header.value = "*, Authorization";
      return headers;
   }
}  // namespace SystemService::http_detail
