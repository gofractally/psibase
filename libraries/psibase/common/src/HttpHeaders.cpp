#include <psibase/HttpHeaders.hpp>

#include <algorithm>
#include <cctype>
#include <charconv>
#include <ranges>
#include "HttpUtil.hpp"

using namespace psibase;
using psibase::detail::split2sv;

namespace
{
   std::optional<std::string> unquote(std::string_view input)
   {
      if (!input.starts_with('"'))
         return std::nullopt;
      std::string result;
      bool        escape = false;
      bool        done   = false;
      for (char ch : input.substr(1))
      {
         if (done)
            return std::nullopt;
         if (escape)
         {
            escape = false;
            result.push_back(ch);
         }
         else if (ch == '\\')
         {
            escape = true;
         }
         else if (ch == '"')
         {
            done = true;
         }
         else
         {
            result.push_back(ch);
         }
      }
      if (escape || !done)
         return std::nullopt;
      return result;
   }

   bool isTChar(char ch)
   {
      return std::isalnum(static_cast<unsigned char>(ch)) ||
             std::string_view{"!#$%&'*+-.^_`|~"}.find(ch) != std::string_view::npos;
   }

   bool isToken(std::string_view s)
   {
      return !s.empty() && std::ranges::all_of(s, isTChar);
   }

   // port or obfport
   bool validatePort(std::string_view port)
   {
      if (port.starts_with('_'))
      {
         if (port.size() < 2)
            return false;
         for (char ch : port.substr(1))
            if (!std::isalnum(static_cast<unsigned char>(ch)) && ch != '.' && ch != '_' &&
                ch != '-')
               return false;
         return true;
      }
      else
      {
         std::uint16_t v;
         const char*   p   = port.data();
         const char*   end = port.data() + port.size();
         auto          res = std::from_chars(p, end, v);
         return res.ec == std::errc{} && res.ptr == end;
      }
   }

   // Forwarded "for" and "by"
   std::optional<IPAddress> parseNodeId(std::string_view value)
   {
      if (value.starts_with('['))
      {
         auto pos = value.find(']');
         if (pos == std::string_view::npos)
            return {};
         if (pos + 1 != value.size() &&
             (value[pos + 1] != ':' || !validatePort(value.substr(pos + 2))))
            return {};
         return parseIPV6Address(value.substr(1, pos - 1));
      }
      else
      {
         auto pos = value.find(':');
         if (pos != std::string_view::npos)
         {
            if (!validatePort(value.substr(pos + 1)))
               return {};
         }
         return parseIPV4Address(value.substr(0, pos));
      }
      return {};
   }

   // Returns nullopt if "for" is not present or is not an IP address
   std::optional<IPAddress> parseForwardedFor(std::string_view forwarded)
   {
      for (auto range : forwarded | std::views::split(';'))
      {
         auto kv  = split2sv(range);
         auto pos = kv.find('=');
         if (pos == std::string_view::npos)
            return std::nullopt;
         auto key   = kv.substr(0, pos);
         auto value = kv.substr(pos + 1);
         if (std::ranges::equal(key, std::string_view{"for"}, {}, ::tolower))
         {
            if (auto q = unquote(value))
               return parseNodeId(*q);
            else if (!isToken(value))
               return std::nullopt;
            else
               return parseNodeId(value);
         }
      }
      return std::nullopt;
   }
}  // namespace

std::vector<std::optional<IPAddress>> psibase::forwardedFor(const HttpRequest& request)
{
   std::vector<std::optional<IPAddress>> result;
   for (const auto& forwarded : request.getHeaderValues("forwarded"))
   {
      result.push_back(parseForwardedFor(forwarded));
   }
   for (const auto& forwardedFor : request.getHeaderValues("x-forwarded-for"))
   {
      result.push_back(parseIPAddress(forwardedFor));
   }
   return result;
}
