#pragma once
#include <psibase/Service.hpp>
#include <psibase/Table.hpp>
#include <psibase/nativeTables.hpp>
#include <psibase/serviceEntry.hpp>

namespace SystemService
{
   struct PendingRequestRow
   {
      std::int32_t           socket;
      psibase::AccountNumber owner;
   };
   PSIO_REFLECT(PendingRequestRow, socket, owner)
   using PendingRequestTable = psibase::Table<PendingRequestRow, &PendingRequestRow::socket>;
   PSIO_REFLECT_TYPENAME(PendingRequestTable)

   struct RegisteredServiceRow
   {
      psibase::AccountNumber service;
      psibase::AccountNumber server;
   };
   PSIO_REFLECT(RegisteredServiceRow, service, server)
   using RegServTable = psibase::Table<RegisteredServiceRow, &RegisteredServiceRow::service>;
   PSIO_REFLECT_TYPENAME(RegServTable)

   struct RedirectRow
   {
      psibase::AccountNumber account;
      psibase::AccountNumber destination;
   };
   PSIO_REFLECT(RedirectRow, account, destination)
   using RedirectTable = psibase::Table<RedirectRow, &RedirectRow::account>;
   PSIO_REFLECT_TYPENAME(RedirectTable)

   /// The `http-server` service routes HTTP requests to the appropriate service
   ///
   /// See [C++ Web Services](../development/services/cpp-service/reference/web-services.md) or
   /// [Rust Web Services](../development/services/rust-service/reference/web-services.md) for more detail on routing,
   /// including how to write services which serve HTTP requests.
   ///
   /// #### serve export (not an action)
   ///
   /// This service has the following WASM exported function:
   ///
   /// ```c++
   /// extern "C" [[clang::export_name("serve")]] void serve()
   /// ```
   ///
   /// `psinode` calls this function on the `http-server` service whenever it receives
   /// an HTTP request that services may serve. This function does the actual routing.
   struct HttpServer : psibase::Service
   {
      static constexpr auto service          = psibase::AccountNumber("http-server");
      static constexpr auto commonApiService = psibase::AccountNumber("common-api");
      static constexpr auto commonApiPrefix  = "/common/";
      static constexpr auto homepageService  = psibase::AccountNumber("homepage");
      using Tables                           = psibase::ServiceTables<RegServTable, RedirectTable>;

      using Session = psibase::SessionTables<PendingRequestTable>;

      void sendProds(const psibase::Action& action);

      /// Indicates that the query is not expected to produce an immediate response
      /// Can be called inside `PSIBASE_SUBJECTIVE_TX`
      void deferReply(std::int32_t socket);
      /// Indicates that a reply will be produced by the current transaction/query/callback
      /// Can be called inside `PSIBASE_SUBJECTIVE_TX`
      void claimReply(std::int32_t socket);
      /// Sends a reply
      void sendReply(std::int32_t socket, psibase::HttpReply response);

      /// Allow another service to send a response to a socket
      ///
      /// The sender must be the current owner of the socket. As long as
      /// `service` does not handle the request, `giveSocket` can be
      /// reversed with `takeSocket`
      void giveSocket(std::int32_t socket, psibase::AccountNumber service);
      /// Take back ownership of a socket
      ///
      /// The socket must have been previously owned by the sender and
      /// neither `sendReply` nor `deferReplay` can have been called on it.
      ///
      /// Returns true if taking ownership was successful
      bool takeSocket(std::int32_t socket);

      /// Register sender's subdomain
      ///
      /// After any subdomain redirect (see `setRedirect`) and `/common/` paths are handled,
      /// `http-server` calls the registered server's `serveSys`. If there is no registered server,
      /// the request is forwarded to `sites` for static hosting.
      ///
      /// Registered services may optionally:
      /// * Serve files via HTTP
      /// * Respond to RPC requests
      /// * Respond to GraphQL requests
      void registerServer(psibase::AccountNumber server);

      // Entry point for messages
      void recv(std::int32_t socket, psio::view<const std::vector<char>> data, std::uint32_t flags);

      // Entry point for HTTP requests
      void serve(std::int32_t socket, psibase::HttpRequest req);

      /// Returns the root host for a given host
      std::string rootHost(psio::view<const std::string> host);

      /// Constructs a URL for a sibling subdomain under the same root host.
      /// If `keepTarget` is true, the original path and query are preserved;
      /// otherwise the URL points to the subdomain root.
      std::string getSiblingUrl(psibase::HttpRequest        req,
                                std::optional<std::int32_t> socket,
                                psibase::AccountNumber      destination,
                                bool                        keepTarget);

      /// Configures the sender's subdomain to permanently redirect (HTTP 308) all
      /// requests to the `destination` subdomain under the same root host. `Location`
      /// URL preserves the original path and query.
      ///
      /// Precedence:
      ///   * Requests whose path starts with `/common/` are handled immediately by `common-api`.
      ///   * All other requests are redirected to the `destination` subdomain (if configured)
      ///     before any routing to the registered server (if any) or to `sites` for static content.
      ///
      /// A caller may not redirect to its own subdomain.
      void setRedirect(psibase::AccountNumber destination);

      /// Removes the redirect set with `setRedirect` for the sender's subdomain. No-op if none is set.
      void clearRedirect();
   };
   PSIO_REFLECT(HttpServer,
                method(sendProds, action),
                method(deferReply, socket),
                method(claimReply, socket),
                method(sendReply, socket, response),
                method(giveSocket, socket, service),
                method(takeSocket, socket),
                method(registerServer, server),
                method(recv, socket, data, flags),
                method(serve, socket, req),
                method(rootHost, host),
                method(getSiblingUrl, req, socket, destination, keepTarget),
                method(setRedirect, destination),
                method(clearRedirect))

   PSIBASE_REFLECT_TABLES(HttpServer, HttpServer::Tables, HttpServer::Session)
}  // namespace SystemService
