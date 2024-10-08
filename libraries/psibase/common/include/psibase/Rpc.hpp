#pragma once

#include <psibase/block.hpp>
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
   };

   // TODO: consider adding headers to this
   /// An HTTP Request
   ///
   /// Most services receive this via their `serveSys` action.
   /// [SystemService::HttpServer] receives it via its `serve` exported function.
   struct HttpRequest
   {
      std::string       host;         ///< Fully-qualified domain name
      std::string       rootHost;     ///< host, but without service subdomain
      std::string       method;       ///< "GET" or "POST"
      std::string       target;       ///< Absolute path, e.g. "/index.js"
      std::string       contentType;  ///< "application/json", "text/html", ...
      std::vector<char> body;         ///< Request body, e.g. POST data
      PSIO_REFLECT(HttpRequest, host, rootHost, method, target, contentType, body)
   };

   enum class HttpStatus : std::uint16_t
   {
      ok                  = 200,
      notFound            = 404,
      internalServerError = 500,
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
   struct HttpReply
   {
      HttpStatus              status = HttpStatus::ok;
      std::string             contentType;  ///< "application/json", "text/html", ...
      std::vector<char>       body;         ///< Response body
      std::vector<HttpHeader> headers;      ///< HTTP Headers
      PSIO_REFLECT(HttpReply, status, contentType, body, headers)
   };

}  // namespace psibase
