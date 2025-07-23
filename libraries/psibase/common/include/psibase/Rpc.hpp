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
   };

   /// An HTTP Request
   ///
   /// Most services receive this via their `serveSys` action.
   /// [SystemService::HttpServer] receives it via its `serve` exported function.
   struct HttpRequest
   {
      std::string             host;         ///< Fully-qualified domain name
      std::string             rootHost;     ///< host, but without service subdomain
      std::string             method;       ///< "GET", "POST", "OPTIONS", "HEAD"
      std::string             target;       ///< Absolute path, e.g. "/index.js"
      std::string             contentType;  ///< "application/json", "text/html", ...
      std::vector<HttpHeader> headers;      ///< HTTP Headers
      std::vector<char>       body;         ///< Request body, e.g. POST data
      PSIO_REFLECT(HttpRequest, host, rootHost, method, target, contentType, headers, body)

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
      /// The value returned is not validated or decoded
      std::optional<std::string_view> getCookie(std::string_view name) const;

      /// Searches for a header by name (case-insensitive)
      ///
      /// The value returned is not validated or decoded
      std::optional<std::string_view> getHeader(std::string_view name) const;

      /// Removes a cookie
      void removeCookie(std::string_view name);

   };

   /// Helper function to check if a URL contains localhost
   inline bool isFromLocalhost(const std::string& url)
   {
      std::string_view value = url;
      
      // Trim whitespace
      auto leading = value.find_first_not_of(" \t");
      auto trailing = value.find_last_not_of(" \t");
      if (leading != std::string_view::npos)
      {
         value = value.substr(leading, trailing - leading + 1);
      }
      else
      {
         return false;
      }

      // Find position of scheme separator
      size_t pos = value.find("://");
      std::string_view domain;
      
      if (pos != std::string_view::npos)
      {
         // Create a string view starting after "://"
         domain = value.substr(pos + 3);
      }
      else
      {
         // No scheme found, treat entire value as domain
         domain = value;
      }

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

      return domain.find("localhost") != std::string_view::npos;
   }

   /// Checks if the request origin indicates a development chain
   /// by looking for "localhost" in the origin header domain
   bool isDevChain(const HttpRequest& request);

   struct URIPath
   {
      std::string path;
   };

   enum class HttpStatus : std::uint16_t
   {
      ok                   = 200,
      notModified          = 304,
      notFound             = 404,
      methodNotAllowed     = 405,
      notAcceptable        = 406,
      unsupportedMediaType = 415,
      internalServerError  = 500,
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
      PSIO_REFLECT(BasicHttpReply, status, contentType, body, headers)
   };

   using HttpReply = BasicHttpReply<std::vector<char>>;

   template <typename T>
   using FracpackHttpReply = BasicHttpReply<psio::nested<T>>;

   template <typename T>
   using JsonHttpReply = BasicHttpReply<psio::nested_json<T>>;

}  // namespace psibase
