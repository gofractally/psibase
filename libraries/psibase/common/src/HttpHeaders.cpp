#include <psibase/HttpHeaders.hpp>

#include <algorithm>
#include <cctype>
#include <charconv>
#include <ranges>

using namespace psibase;

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
      std::optional<IPAddress>      result;
      std::vector<std::string_view> parameterNames;
      for (auto kv : QSplit{forwarded, ';'})
      {
         auto pos = kv.find('=');
         if (pos == std::string_view::npos)
            return std::nullopt;
         auto key   = kv.substr(0, pos);
         auto value = kv.substr(pos + 1);
         auto q     = unquote(value);
         if (!q && !isToken(value))
            return std::nullopt;
         if (q)
            value = *q;
         if (std::ranges::any_of(parameterNames, [&](auto k) { return iequal(k, key); }))
            return std::nullopt;
         parameterNames.push_back(key);
         if (iequal(key, "for"))
         {
            result = parseNodeId(value);
         }
      }
      return result;
   }

   const char* findSeparator(const char* pos, const char* end, char ch)
   {
      while (pos != end)
      {
         if (*pos == ch)
         {
            return pos;
         }
         else if (*pos == '"')
         {
            // Find the end of the double-quoted string
            ++pos;
            while (true)
            {
               if (pos == end)
               {
                  return pos;
               }
               if (*pos == '\\')
               {
                  ++pos;
                  if (pos == end)
                  {
                     return pos;
                  }
               }
               else if (*pos == '"')
               {
                  break;
               }
               ++pos;
            }
         }
         ++pos;
      }
      return pos;
   }
}  // namespace

char ToLower::operator()(unsigned char ch) const
{
   return static_cast<char>(std::tolower(ch));
}

std::string ToLower::operator()(std::string_view s) const
{
   std::string result{s};
   for (char& ch : result)
      ch = (*this)(ch);
   return result;
}

bool psibase::iequal(std::string_view lhs, std::string_view rhs)
{
   return std::ranges::equal(lhs, rhs, {}, ToLower{}, ToLower{});
}

QSplitIterator::QSplitIterator(std::string_view s, char ch)
    : start(s.data()), end(s.data() + s.size()), ch(ch)
{
   pos = findSeparator(start, end, ch);
}

QSplitIterator& QSplitIterator::operator++()
{
   if (pos == end)
   {
      ch = '"';
      return *this;
   }
   ++pos;
   start = pos;
   pos   = findSeparator(pos, end, ch);
   return *this;
}

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
