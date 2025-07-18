#include <psibase/Rpc.hpp>

#include <ranges>

namespace
{
   template <typename Iter>
   char read_pct(Iter& iter, Iter end)
   {
      auto read_digit = [&]
      {
         ++iter;
         if (iter != end)
         {
            if (*iter >= '0' && *iter <= '9')
               return *iter - '0';
            else if (*iter >= 'a' && *iter <= 'f')
               return *iter - 'a' + 10;
            else if (*iter >= 'A' && *iter <= 'F')
               return *iter - 'A' + 10;
         }
         psibase::abortMessage("Invalid pct-encoded");
      };
      auto upper = read_digit();
      auto lower = read_digit();
      return (upper << 4) | lower;
   }

   std::string decode_pct(std::string_view s)
   {
      std::string result;
      for (auto iter = s.begin(), end = s.end(); iter != end; ++iter)
      {
         if (*iter == '%')
            result += read_pct(iter, end);
         else
            result += *iter;
      }
      return result;
   }

   // Used to convert a split_view element to a string_view.
   // Note that this is only needed when the standard library
   // doesn't implement P2210R2
   std::string_view split2sv(const auto& r)
   {
      auto data = &*r.begin();
      auto size = static_cast<std::size_t>(std::ranges::distance(r));
      return std::string_view{data, size};
   }
}  // namespace

namespace psibase
{
   bool HttpHeader::matches(std::string_view h) const
   {
      return std::ranges::equal(name, h, {}, ::tolower, ::tolower);
   }

   std::pair<std::string, std::string> HttpRequest::readQueryItem(std::string_view& query)
   {
      auto end   = query.find('&');
      auto split = query.substr(0, end).find('=');

      auto key   = query.substr(0, split);
      auto value = split > end ? std::string_view{} : query.substr(split + 1, end - split - 1);

      if (end == std::string_view::npos)
      {
         query.remove_prefix(query.size());
      }
      else
      {
         query.remove_prefix(end + 1);
      }
      return {decode_pct(key), decode_pct(value)};
   }

   std::string HttpRequest::path() const
   {
      return decode_pct(std::string_view(target).substr(0, target.find('?')));
   }

   std::optional<std::string_view> HttpRequest::getCookie(std::string_view name) const
   {
      for (const auto& header : headers)
      {
         if (std::ranges::equal(header.name, std::string_view{"cookie"}, {}, ::tolower))
         {
            for (auto kvrange : header.value | std::views::split(';'))
            {
               std::string_view kv  = split2sv(kvrange);
               auto             pos = kv.find('=');
               check(pos != std::string_view::npos, "Invalid cookie");
               auto leading = kv.find_first_not_of(" \t");
               auto key     = kv.substr(leading, pos - leading);
               auto value   = kv.substr(pos + 1);
               if (key == name)
                  return value;
            }
         }
      }
      return {};
   }

   void HttpRequest::removeCookie(std::string_view name)
   {
      for (auto iter = headers.begin(), end = headers.end(); iter != end;)
      {
         auto& header = *iter;
         if (std::ranges::equal(header.name, std::string_view{"cookie"}, {}, ::tolower))
         {
            std::string newValue;
            bool        first = true;
            for (auto kvrange : header.value | std::views::split(';'))
            {
               std::string_view kv  = split2sv(kvrange);
               auto             pos = kv.find('=');
               check(pos != std::string_view::npos, "Invalid cookie");
               bool matched = false;
               auto leading = kv.find_first_not_of(" \t");
               auto key     = kv.substr(leading, pos - leading);
               auto value   = kv.substr(pos + 1);
               matched      = key == name;
               if (key != name)
               {
                  if (first)
                     first = false;
                  else
                     newValue += "; ";
                  newValue += kv.substr(leading);
               }
            }
            if (newValue.empty())
            {
               headers.erase(iter);
               continue;
            }
            header.value = std::move(newValue);
         }
         ++iter;
      }
   }

   bool HttpRequest::isDevChainOrigin() const
   {
      // Check the host field first (always present)
      if (host.find("localhost") != std::string::npos)
      {
         return true;
      }
      
      // Also check origin header if present (for cross-origin requests)
      for (const auto& header : headers)
      {
         if (std::ranges::equal(header.name, std::string_view{"origin"}, {}, ::tolower))
         {
            for (auto part : header.value | std::views::split(','))
            {
               std::string_view value = split2sv(part);
               
               // Trim whitespace
               auto leading = value.find_first_not_of(" \t");
               auto trailing = value.find_last_not_of(" \t");
               if (leading != std::string_view::npos)
               {
                  value = value.substr(leading, trailing - leading + 1);
               }
               else
               {
                  continue;
               }

               // Find position of scheme separator
               size_t pos = value.find("://");
               if (pos == std::string_view::npos)
               {
                  continue;  // No scheme found
               }

               // Create a string view starting after "://"
               std::string_view domain = value.substr(pos + 3);

               // Find the end of the domain name (either at first colon or slash, or end of string)
               size_t domainEndPos = domain.find(':');
               if (domainEndPos == std::string_view::npos)
               {
                  domainEndPos = domain.find('/');
               }
               if (domainEndPos != std::string_view::npos)
               {
                  domain = domain.substr(0, domainEndPos);
               }

               if (domain.find("localhost") != std::string_view::npos)
               {
                  return true;
               }
            }
         }
      }
      return false;
   }
}  // namespace psibase
