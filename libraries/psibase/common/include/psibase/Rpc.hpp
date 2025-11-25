#pragma once

#include <psibase/block.hpp>
#include <psio/nested.hpp>
#include <string>
#include <vector>

namespace psibase
{
   // TODO: add this to web-services.md. Add note about proxy limiting who can set headers.
   struct HttpHeader
   {
      std::string name;
      std::string value;
      PSIO_REFLECT(HttpHeader, definitionWillNotChange(), name, value)

      bool matches(std::string_view h) const;

      static std::optional<std::string_view> get(const std::vector<HttpHeader>&,
                                                 std::string_view name);
      static std::vector<std::string_view>   split(const std::vector<HttpHeader>&,
                                                   std::string_view name);
   };

   /// An HTTP Request
   ///
   /// Most services receive this via their `serveSys` action.
   /// [SystemService::HttpServer] receives it via its `serve` exported function.
   struct HttpRequest
   {
      std::string             host;         ///< Fully-qualified domain name
      std::string             method;       ///< "GET", "POST", "OPTIONS", "HEAD"
      std::string             target;       ///< Absolute path, e.g. "/index.js"
      std::string             contentType;  ///< "application/json", "text/html", ...
      std::vector<HttpHeader> headers;      ///< HTTP Headers
      std::vector<char>       body;         ///< Request body, e.g. POST data
      PSIO_REFLECT(HttpRequest, host, method, target, contentType, headers, body)

      static std::pair<std::string, std::string> readQueryItem(std::string_view&);

      /// Parses the query component
      ///
      /// T must be a reflected type, whose fields are assignable from
      /// a temporary string. The names of the fields are the query keys.
      /// The query should have the form `key1=value1&key2=value2...`
      ///
      /// The values will have %XX escapes decoded.
      template <typename T>
      T query() const
      {
         T    result{};
         auto pos = target.find('?');
         if (pos != std::string::npos)
         {
            auto query = std::string_view{target}.substr(pos + 1);
            while (!query.empty())
            {
               auto [key, value] = readQueryItem(query);
               psio::get_data_member<T>(key, [&](auto m) { result.*m = std::move(value); });
            }
         }
         return result;
      }

      /// Returns the path component
      ///
      // %XX escapes are decoded.
      std::string path() const;

      /// Searches for a cookie by name
      ///
      /// The values returned are not validated or decoded
      std::vector<std::string_view> getCookie(std::string_view name) const;

      /// Searches for a header by name (case-insensitive)
      ///
      /// The value returned is not validated or decoded
      std::optional<std::string_view> getHeader(std::string_view name) const;

      /// Searches for all instances of a header by name and splits at commas
      std::vector<std::string_view> getHeaderValues(std::string_view name) const;

      /// Removes a cookie
      void removeCookie(std::string_view name);

      /// Removes a header
      void removeHeader(std::string_view name);
   };

   /// Checks if the host indicates a development chain
   /// by looking for "localhost" in the host header
   bool isLocalhost(const HttpRequest& request);

   /// Return the root host for the request.
   /// - isSubdomain: indicates whether the host of the request is a
   ///   subdomain. If the host is not a subdomain, then the host
   ///   is the root host.
   ///
   /// Note: In most services, isSubdomain will be true, because
   /// the subdomain is used to dispatch serveSys. However, there
   /// are a few places that handle requests for any domain. These
   /// should typically use to<HttpServer>().rootHost (or XHttp for
   /// local services).
   std::string_view rootHost(const HttpRequest& request, bool isSubdomain = true);

   struct SplitURL
   {
      std::string_view scheme;
      std::string_view host;
      std::string_view path;
   };
   SplitURL splitURL(std::string_view url);

   struct URIPath
   {
      std::string path;
   };

   enum class HttpStatus : std::uint16_t
   {
      continue_                   = 100,
      switchingProtocols          = 101,
      ok                          = 200,
      created                     = 201,
      accepted                    = 202,
      nonAuthoritativeInformation = 203,
      noContent                   = 204,
      resetContent                = 205,
      partialContent              = 206,
      multipleChoices             = 300,
      movedPermanently            = 301,
      found                       = 302,
      seeOther                    = 303,
      notModified                 = 304,
      temporaryRedirect           = 307,
      permanentRedirecct          = 308,
      badRequest                  = 400,
      unauthorized                = 401,
      forbidden                   = 403,
      notFound                    = 404,
      methodNotAllowed            = 405,
      notAcceptable               = 406,
      proxyAuthenticationRequired = 407,
      requestTimeout              = 408,
      conflict                    = 409,
      gone                        = 410,
      lengthRequired              = 411,
      preconditionFailed          = 412,
      contentTooLarge             = 413,
      uriTooLong                  = 414,
      unsupportedMediaType        = 415,
      rangeNotSatisfiable         = 416,
      expectationFailed           = 417,
      misdirectedRequest          = 421,
      unprocessableContent        = 422,
      upgradeRequired             = 426,
      internalServerError         = 500,
      notImplemented              = 501,
      badGateway                  = 502,
      serviceUnavailable          = 503,
      gatewayTimeout              = 504,
      httpVersionNotSupported     = 505
   };

   void from_json(HttpStatus& status, auto& stream)
   {
      std::uint16_t value;
      from_json(value, stream);
      status = static_cast<HttpStatus>(value);
   }

   void to_json(const HttpStatus& status, auto& stream)
   {
      to_json(static_cast<std::uint16_t>(status), stream);
   }

   /// An HTTP reply
   ///
   /// Services return this from their `serveSys` action.
   template <typename T>
   struct BasicHttpReply
   {
      HttpStatus              status = HttpStatus::ok;
      std::string             contentType;  ///< "application/json", "text/html", ...
      T                       body;         ///< Response body
      std::vector<HttpHeader> headers;      ///< HTTP Headers

      /// Searches for a header by name (case-insensitive)
      ///
      /// The value returned is not validated or decoded
      std::optional<std::string_view> getHeader(std::string_view name) const
      {
         return HttpHeader::get(headers, name);
      }

      /// Searches for all instances of a header by name and splits at commas
      std::vector<std::string_view> getHeaderValues(std::string_view name) const
      {
         return HttpHeader::split(headers, name);
      }

      static BasicHttpReply methodNotAllowed(const HttpRequest& req);

      PSIO_REFLECT(BasicHttpReply, status, contentType, body, headers)
   };

   std::vector<HttpHeader> allowCors(std::string_view origin = "*");
   std::vector<HttpHeader> allowCors(const HttpRequest& req,
                                     AccountNumber      account,
                                     bool               hostIsSubdomain = true);
   std::vector<HttpHeader> allowCorsSubdomains(const HttpRequest& req, bool hostIsSubdomain = true);

   using HttpReply = BasicHttpReply<std::vector<char>>;

   template <typename T>
   using FracpackHttpReply = BasicHttpReply<psio::nested<T>>;

   template <typename T>
   using JsonHttpReply = BasicHttpReply<psio::nested_json<T>>;

}  // namespace psibase
