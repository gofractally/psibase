#pragma once

#include <boost/beast/http/fields.hpp>
#include <optional>
#include <psibase/HttpHeaders.hpp>
#include <string_view>

namespace psibase::http
{
   // Cookie-name of a Set-Cookie field value (RFC 6265 §5.2).
   // Empty when the value has no name.
   inline std::optional<std::string_view> cookieName(std::string_view value)
   {
      if (auto semi = value.find(';'); semi != std::string_view::npos)
         value = value.substr(0, semi);
      auto eq = value.find('=');
      if (eq == std::string_view::npos)
         return std::nullopt;
      value      = value.substr(0, eq);
      auto start = value.find_first_not_of(" \t");
      if (start == std::string_view::npos)
         return std::nullopt;
      auto end = value.find_last_not_of(" \t");
      return value.substr(start, end - start + 1);
   }

   // One Set-Cookie field per cookie name. A later value replaces the earlier
   // one and is not comma-joined.
   inline void mergeSetCookie(boost::beast::http::fields& fields, const HttpHeader& header)
   {
      if (auto name = cookieName(header.value))
      {
         for (auto it = fields.begin(); it != fields.end();)
         {
            if (iequal(it->name_string(), "set-cookie") && cookieName(it->value()) == name)
            {
               it = fields.erase(it);
               continue;
            }
            ++it;
         }
      }
      // No cookie-name: RFC 6265 §5.2 ignores the pair. Still emit the field;
      // nothing identifies an earlier field to replace.
      fields.insert(header.name, header.value);
   }
}  // namespace psibase::http
