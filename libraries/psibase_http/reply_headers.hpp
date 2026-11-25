#pragma once

#include <optional>
#include <psibase/HttpHeaders.hpp>
#include <string_view>
#include <unordered_set>
#include <vector>

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
   // one and is not comma-joined. Headers with no parseable name are kept.
   inline void dedupeSetCookie(HttpHeaders& headers)
   {
      std::unordered_set<std::string_view> seen;
      std::vector<std::uint8_t>            keep(headers.size(), 1);
      for (std::size_t i = headers.size(); i-- > 0;)
      {
         const auto& h = headers[i];
         if (!h.matches("set-cookie"))
            continue;
         if (auto name = cookieName(h.value))
         {
            if (!seen.insert(*name).second)
               keep[i] = 0;
         }
      }

      std::size_t write = 0;
      for (std::size_t i = 0; i < headers.size(); ++i)
      {
         if (!keep[i])
            continue;
         if (write != i)
            headers[write] = std::move(headers[i]);
         ++write;
      }
      headers.resize(write);
   }
}  // namespace psibase::http