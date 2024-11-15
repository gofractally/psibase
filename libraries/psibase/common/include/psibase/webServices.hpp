#pragma once
#include <psibase/Service.hpp>
#include <psibase/serviceEntry.hpp>

namespace psibase
{
   /// Interface for services which serve http
   ///
   /// `http-server` uses this interface to call into services to respond to http requests.
   ///
   /// > ⚠️ Do **not** inherit from this. To implement this interface, add a [serveSys] action
   /// to your service and reflect it.
   struct ServerInterface
   {
      /// Handle HTTP requests
      ///
      /// Define this action in your service to handle HTTP requests. You'll also need to
      /// register your service with [http-server](/default-apps/http-server.md).
      ///
      /// `serveSys` can do any of the following:
      ///
      /// - Return `std::nullopt` to signal not found. psinode produces a 404 response in this case.
      /// - Abort. psinode produces a 500 response with the service's abort message.
      /// - Return a [psibase::HttpReply]. psinode produces a 200 response with the body and contentType returned.
      /// - Call other services.
      /// - Call `http-server::sendReply`. Explicitly sends a response.
      /// - Call `http-server::deferReply`. No response will be produced until `http-server::sendReply` is called.
      ///
      /// A service runs in RPC mode while serving an HTTP request. This mode prevents database writes,
      /// but allows database reads, including reading data and events which are normally not available
      /// to services; see [psibase::DbId].
      //
      // Note: intentionally doesn't use psio::const_view, since that complicates documentation.
      //       implementations of this interface may, of course, use it.
      std::optional<HttpReply> serveSys(HttpRequest request, std::optional<std::int32_t> socket);
      PSIO_REFLECT(ServerInterface, method(serveSys, request, socket))
   };

}  // namespace psibase
