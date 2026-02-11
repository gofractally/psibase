#include <psibase/Rpc.hpp>

#include <ranges>
#include "HttpUtil.hpp"

using psibase::detail::split2sv;

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

   struct Origin
   {
      std::string_view scheme;
      std::string_view host;

      Origin(std::string_view url)
      {
         auto pos = url.find("://");
         if (pos != std::string_view::npos)
         {
            scheme = url.substr(0, pos);
            host   = url.substr(pos + 3);
            pos    = host.rfind(':');
            if (pos != std::string_view::npos && host.find(']', pos) == std::string_view::npos)
               host = host.substr(0, pos);
         }
      }

      bool isSecure() const
      {
         return scheme == "https" || host == "localhost" || host.ends_with(".localhost");
      }

      bool isService(std::string_view rootHost, psibase::AccountNumber account)
      {
         return isSecure() && account.str() + '.' + std::string(rootHost) == host;
      }

      bool isSubdomain(std::string_view rootHost)
      {
         return isSecure() && host == rootHost || host.ends_with('.' + std::string(rootHost));
      }
   };
}  // namespace

namespace psibase
{
   bool HttpHeader::matches(std::string_view h) const
   {
      return std::ranges::equal(name, h, {}, ::tolower, ::tolower);
   }

   std::optional<std::string_view> HttpHeader::get(const std::vector<HttpHeader>& headers,
                                                   std::string_view               name)
   {
      for (const auto& header : headers)
      {
         if (header.matches(name))
         {
            return header.value;
         }
      }
      return {};
   }

   std::vector<std::string_view> HttpHeader::split(const std::vector<HttpHeader>& headers,
                                                   std::string_view               name)
   {
      std::vector<std::string_view> result;
      for (const auto& header : headers)
      {
         if (header.matches(name))
         {
            for (auto range : header.value | std::views::split(','))
            {
               std::string_view value = split2sv(range);

               auto low  = value.find_first_not_of(" \t");
               auto high = value.find_last_not_of(" \t");
               if (low == std::string::npos)
                  result.push_back("");
               else
                  result.push_back(value.substr(low, high - low + 1));
            }
         }
      }
      return result;
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

   std::vector<std::string_view> HttpRequest::getCookie(std::string_view name) const
   {
      if (auto cookieHeader = getHeader("cookie"))
      {
         std::vector<std::string_view> values;
         for (auto kvrange : *cookieHeader | std::views::split(';'))
         {
            std::string_view kv  = split2sv(kvrange);
            auto             pos = kv.find('=');
            check(pos != std::string_view::npos, "Invalid cookie");
            auto leading = kv.find_first_not_of(" \t");
            auto key     = kv.substr(leading, pos - leading);
            auto value   = kv.substr(pos + 1);
            if (key == name)
               values.push_back(value);
         }
         return values;
      }
      return {};
   }

   std::optional<std::string_view> HttpRequest::getHeader(std::string_view name) const
   {
      return HttpHeader::get(headers, name);
   }

   std::vector<std::string_view> HttpRequest::getHeaderValues(std::string_view name) const
   {
      return HttpHeader::split(headers, name);
   }

   void HttpRequest::removeCookie(std::string_view name)
   {
      for (auto iter = headers.begin(); iter != headers.end();)
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
               auto leading = kv.find_first_not_of(" \t");
               auto key     = kv.substr(leading, pos - leading);
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
               iter = headers.erase(iter);
               continue;
            }
            header.value = std::move(newValue);
         }
         ++iter;
      }
   }

   void HttpRequest::removeHeader(std::string_view name)
   {
      std::erase_if(headers, [name](const HttpHeader& header) { return header.matches(name); });
   }

   bool isLocalhost(const HttpRequest& request)
   {
      std::string_view domain = request.host;

      // Find the end of the domain name (either at first colon or end of string)
      size_t domainEndPos = domain.find(':');
      if (domainEndPos != std::string_view::npos)
      {
         domain = domain.substr(0, domainEndPos);
      }

      if (domain == "localhost")
      {
         return true;
      }

      if (domain.size() > 10 && domain.ends_with(".localhost"))
      {
         return true;
      }

      return false;
   }

   std::string_view rootHost(const HttpRequest& request, bool hostIsSubdomain)
   {
      if (hostIsSubdomain)
      {
         auto sv  = std::string_view(request.host);
         auto pos = sv.find('.');
         psibase::check(pos != std::string_view::npos, "Subdomain expected");
         return sv.substr(pos + 1);
      }
      else
      {
         return std::string_view(request.host);
      }
   }

   SplitURL splitURL(std::string_view uri)
   {
      std::string_view scheme;
      if (uri.starts_with("http://"))
      {
         scheme = uri.substr(0, 4);
         uri    = uri.substr(7);
      }
      else if (uri.starts_with("https://"))
      {
         scheme = uri.substr(0, 5);
         uri    = uri.substr(8);
      }
      else
      {
         return {};
      }
      auto pos         = uri.find('/');
      auto authority   = uri.substr(0, pos);
      auto path        = pos == std::string::npos ? "/" : uri.substr(pos);
      auto enduserinfo = authority.find('@');
      auto host = enduserinfo == std::string::npos ? authority : authority.substr(enduserinfo + 1);
      return {scheme, host, path};
   }

   std::vector<HttpHeader> allowCors(std::string_view origin)
   {
      return {
          {"Access-Control-Allow-Origin", std::string(origin)},
          {"Access-Control-Allow-Methods", "POST, GET, OPTIONS, HEAD, PUT, DELETE"},
          {"Access-Control-Allow-Headers", "*"},
      };
   }

   std::vector<HttpHeader> allowCors(const HttpRequest& req,
                                     AccountNumber      account,
                                     bool               hostIsSubdomain)
   {
      if (auto origin = req.getHeader("origin");
          origin && Origin(*origin).isService(rootHost(req, hostIsSubdomain), account))
      {
         return allowCors(*origin);
      }
      return {};
   }

   std::vector<HttpHeader> allowCorsSubdomains(const HttpRequest& req, bool hostIsSubdomain)
   {
      if (auto origin = req.getHeader("origin");
          origin && Origin(*origin).isSubdomain(rootHost(req, hostIsSubdomain)))
      {
         return allowCors(*origin);
      }
      return {};
   }

   template <typename T>
   BasicHttpReply<T> BasicHttpReply<T>::methodNotAllowed(const HttpRequest& req)
   {
      auto message =
          "The resource '" + req.target + "' does not accept the method " + req.method + ".\n";
      return HttpReply{.status      = HttpStatus::methodNotAllowed,
                       .contentType = "text/html",
                       .body{message.begin(), message.end()}};
   }

   template HttpReply HttpReply::methodNotAllowed(const HttpRequest&);

}  // namespace psibase
