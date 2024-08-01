#pragma once

#include <optional>
#include <psibase/Rpc.hpp>
#include <psibase/schema.hpp>
#include <psio/stream.hpp>
#include <psio/to_json.hpp>

namespace psibase
{

   /// Handle `/schema` request
   ///
   /// If `request` is a GET to `/schema`, then this returns JSON for a
   /// ServiceSchema object.
   ///
   /// If `request` doesn't match the above, then this returns `std::nullopt`.
   template <typename Service>
   std::optional<HttpReply> serveSchema(const HttpRequest& request)
   {
      if (request.method == "GET" && request.target == "/schema")
      {
         HttpReply           reply{.contentType = "application/json"};
         psio::vector_stream stream{reply.body};
         AccountNumber       service = {};
         if constexpr (requires { Service::service; })
         {
            service = Service::service;
         }
         to_json(ServiceSchema::make<Service>(service), stream);
         return reply;
      }
      return std::nullopt;
   }
}  // namespace psibase
