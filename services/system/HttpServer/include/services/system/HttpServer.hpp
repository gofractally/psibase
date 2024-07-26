#pragma once
#include <psibase/Service.hpp>
#include <psibase/Table.hpp>
#include <psibase/nativeTables.hpp>
#include <psibase/serviceEntry.hpp>

namespace SystemService
{

   /// Each table record contains a service and it's registered HTTP Server service.
   struct RegisteredServiceRow
   {
      psibase::AccountNumber service;
      psibase::AccountNumber server;
   };
   PSIO_REFLECT(RegisteredServiceRow, service, server)
   using RegServTable = psibase::Table<RegisteredServiceRow, &RegisteredServiceRow::service>;

   /// The `http-server` service routes HTTP requests to the appropriate service
   ///
   /// Rule set:
   /// - If the target starts with `/common`, then route the request to [SystemService::CommonApi].
   /// - Else if there's a subdomain and it references a registered service, then route the request to that service.
   /// - Else if the request references an unregistered subdomain, then route the request to `sites`.
   /// - Else route the request to [CommonApi]; this handles the chain's main domain.
   ///
   /// See [C++ Web Services](../development/services/cpp-service/reference/web-services.md) or
   /// [Rust Web Services](../development/services/rust-service/reference/web-services.md) for more detail,
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
   /// `psinode` has a local option (TODO: implement) which may choose an alternative
   /// routing service instead.
   struct HttpServer : psibase::Service<HttpServer>
   {
      static constexpr auto service = psibase::proxyServiceNum;
      using Tables                  = psibase::ServiceTables<RegServTable>;

      /// Register sender's subdomain
      ///
      /// When requests are made to the sender service subdomain, `http-server` will
      /// forward the request into the `serveSys` action of the specified `server`
      /// for it to handle the request.
      ///
      /// Registered services may optionally:
      /// * Serve files via HTTP
      /// * Respond to RPC requests
      /// * Respond to GraphQL requests
      void registerServer(psibase::AccountNumber server);
   };
   PSIO_REFLECT(HttpServer, method(registerServer, server))
}  // namespace SystemService
