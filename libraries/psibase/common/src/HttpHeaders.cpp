#include <psibase/HttpHeaders.hpp>

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

   // Forwarded "for" and "by"
   std::optional<IPAddress> parseNodeId(std::string_view value)
   {
      if (value.starts_with('['))
      {
         if (value.ends_with(']'))
         {
            return parseIPV6Address(value);
         }
         else
         {
            if (auto result = parseIPV6Endpoint(value))
               return result->address;
         }
      }
      else
      {
         if (value.find(':') != std::string_view::npos)
         {
            if (auto result = parseIPV4Endpoint(value))
               return result->address;
         }
         else
         {
            return parseIPV4Address(value);
         }
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
