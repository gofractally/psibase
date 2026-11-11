#include <psibase/HttpHeaders.hpp>

#include <algorithm>
#include <cctype>
#include <charconv>

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

   std::optional<std::string> parseForwardedParam(std::string_view forwarded,
                                                  std::string_view param)
   {
      std::optional<std::string>    result;
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
         if (std::ranges::any_of(parameterNames, [&](auto k) { return iequal(k, key); }))
            return std::nullopt;
         parameterNames.push_back(key);
         if (iequal(key, param))
            result = q ? std::move(*q) : std::string(value);
      }
      return result;
   }

   // Returns nullopt if "for" is not present or is not an IP address
   std::optional<IPAddress> parseForwardedFor(std::string_view forwarded)
   {
      if (auto value = parseForwardedParam(forwarded, "for"))
         return parseNodeId(*value);
      return std::nullopt;
   }

   std::string_view trimWhitespace(std::string_view s)
   {
      auto low = s.find_first_not_of(" \t");
      if (low == std::string_view::npos)
         return {};
      auto high = s.find_last_not_of(" \t");
      return s.substr(low, high - low + 1);
   }

   // Parses a qvalue (e.g. "0.5") into thousandths
   std::optional<int> parseQValue(std::string_view param)
   {
      // qvalue = ( "0" [ "." 0*3DIGIT ] ) / ( "1" [ "." 0*3("0") ] )
      if (param.empty() || (param[0] != '0' && param[0] != '1'))
         return std::nullopt;
      int q = param[0] == '1' ? 1000 : 0;
      param.remove_prefix(1);
      if (!param.empty())
      {
         if (param[0] != '.' || param.size() > 4)
            return std::nullopt;
         param.remove_prefix(1);
         int scale = 100;
         for (char ch : param)
         {
            if (ch < '0' || ch > '9')
               return std::nullopt;
            q += (ch - '0') * scale;
            scale /= 10;
         }
         if (q > 1000)
            return std::nullopt;
      }
      return q;
   }

   // Parses a weight parameter (e.g. "q=0.5") into thousandths. A malformed weight
   // counts as 0. Returns nullopt for other parameters.
   std::optional<int> parseQ(std::string_view param)
   {
      if (param.size() < 2 || (param[0] != 'q' && param[0] != 'Q') || param[1] != '=')
         return std::nullopt;
      return parseQValue(param.substr(2)).value_or(0);
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

std::optional<std::string> psibase::forwardedProto(const HttpHeaders& headers)
{
   if (auto value = HttpHeader::get(headers, "x-forwarded-proto"))
   {
      if (iequal(*value, "https") || iequal(*value, "http"))
         return ToLower{}(std::string(*value));
   }
   for (const auto& forwarded : HttpHeader::split(headers, "forwarded"))
   {
      if (auto proto = parseForwardedParam(forwarded, "proto"))
      {
         auto lower = ToLower{}(*proto);
         if (lower == "https" || lower == "http")
            return lower;
      }
   }
   return std::nullopt;
}

int psibase::acceptWeight(const HttpHeaders& headers,
                          std::string_view   type,
                          std::string_view   subtype)
{
   int bestSpecificity = -1;
   int weight          = 0;
   for (auto range : HttpHeader::split(headers, "accept"))
   {
      int  specificity = -1;
      int  q           = 1000;
      bool first       = true;
      for (auto part : QSplit{range, ';'})
      {
         auto param = trimWhitespace(part);
         if (first)
         {
            first      = false;
            auto slash = param.find('/');
            if (slash == std::string_view::npos)
               break;
            auto rangeType    = param.substr(0, slash);
            auto rangeSubtype = param.substr(slash + 1);
            if (iequal(rangeType, type) && iequal(rangeSubtype, subtype))
               specificity = 2;
            else if (iequal(rangeType, type) && rangeSubtype == "*")
               specificity = 1;
            else if (rangeType == "*" && rangeSubtype == "*")
               specificity = 0;
            else
               break;
         }
         else if (auto newQ = parseQ(param))
         {
            q = *newQ;
         }
      }
      if (specificity > bestSpecificity)
      {
         bestSpecificity = specificity;
         weight          = q;
      }
   }
   return weight;
}

std::string_view psibase::hostHeaderPortSuffix(const HttpRequest& request)
{
   if (auto host = request.getHeader("host"))
   {
      std::string_view h = *host;
      if (auto pos = h.rfind(':'); pos != std::string_view::npos)
      {
         // A ']' after the last ':' means that the colon is inside a
         // bracketed IPv6 literal, so there is no port.
         if (h.find(']', pos) == std::string_view::npos)
            return h.substr(pos);
      }
   }
   return {};
}
