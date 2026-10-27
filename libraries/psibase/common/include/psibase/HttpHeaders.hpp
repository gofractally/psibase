#pragma once

#include <optional>
#include <psibase/Rpc.hpp>
#include <psibase/SocketInfo.hpp>

namespace psibase
{
   struct ToLower
   {
      char        operator()(unsigned char ch) const;
      std::string operator()(std::string_view s) const;
   };
   bool iequal(std::string_view lhs, std::string_view rhs);

   struct QSplitSentinel
   {
   };
   struct QSplitIterator
   {
     public:
      using value_type      = std::string_view;
      using difference_type = std::ptrdiff_t;
      QSplitIterator(std::string_view s, char ch);
      std::string_view operator*() const { return {start, pos}; }
      friend bool      operator==(const QSplitIterator& lhs, const QSplitSentinel&)
      {
         return lhs.ch == '"';
      }
      QSplitIterator& operator++();
      QSplitIterator  operator++(int)
      {
         auto old = *this;
         ++*this;
         return old;
      }

     private:
      const char* start;
      const char* pos;
      const char* end;
      char        ch;
   };

   /// Splits a string_view at a separator char, but ignores the separator
   /// inside double-quotes. The separator must not be "
   struct QSplit
   {
     public:
      QSplit(std::string_view s, char ch) : s(s), ch(ch) {}
      QSplitIterator begin() const { return {s, ch}; }
      QSplitSentinel end() const { return {}; }

     private:
      std::string_view s;
      char             ch;
   };

   /// Parses the Forwarded and X-Forwarded-For headers
   /// and returns a list of IP addresses. Unparsable
   /// items and items that have a missing, opaque or
   /// unknown "for" field are represented as nullopt.
   std::vector<std::optional<IPAddress>> forwardedFor(const HttpRequest& request);

   /// Parses the X-Forwarded-Proto and Forwarded headers
   /// and returns the first valid protocol ("http" or "https").
   std::optional<std::string> forwardedProto(const HttpHeaders& headers);
   template <typename T>
   std::optional<std::string> forwardedProto(const BasicHttpRequest<T>& request)
   {
      return forwardedProto(request.headers);
   }

   /// Returns the port suffix of the Host header, including the ':'
   /// (e.g. ":8080"), or an empty string if the header has no port.
   /// The result points into the request's headers.
   template <typename T>
   std::string_view hostHeaderPortSuffix(const BasicHttpRequest<T>& request)
   {
      if (auto host = request.getHeader("host"))
      {
         std::string_view h = *host;
         if (auto pos = h.rfind(':'); pos != std::string_view::npos)
         {
            // A ']' after the last ':' means the colon is inside a bracketed
            // IPv6 literal, so there is no port.
            if (h.find(']', pos) == std::string_view::npos)
               return h.substr(pos);
         }
      }
      return {};
   }

   /// Whether the browser-facing scheme is https. `tls` applies when the
   /// request carries no forwarded protocol.
   template <typename T>
   bool publicHttps(const BasicHttpRequest<T>& request, bool tls)
   {
      if (auto proto = forwardedProto(request))
         return *proto == "https";
      return tls;
   }

   /// Absolute URL for a browser-facing origin. `tls` applies when the request
   /// carries no forwarded protocol. Does not read sockets.
   template <typename T>
   std::string publicUrl(const BasicHttpRequest<T>& request,
                         bool                       tls,
                         std::string_view           host,
                         std::string_view           path)
   {
      std::string url;
      url += publicHttps(request, tls) ? "https://" : "http://";
      url += host;
      url.append(hostHeaderPortSuffix(request));
      url += path;
      return url;
   }
}  // namespace psibase
