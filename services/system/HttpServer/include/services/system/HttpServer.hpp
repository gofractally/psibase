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

   struct RegisteredServiceRow
   {
      psibase::AccountNumber service;
      psibase::AccountNumber server;
   };
   PSIO_REFLECT(RegisteredServiceRow, service, server)
   using RegServTable = psibase::Table<RegisteredServiceRow, &RegisteredServiceRow::service>;

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
   /// `psinode` has a local option (TODO: implement) which may choose an alternative
   /// routing service instead.
   struct HttpServer : psibase::Service
   {
      static constexpr auto service = psibase::proxyServiceNum;
      using Tables                  = psibase::ServiceTables<RegServTable>;

      using Subjective = psibase::SubjectiveTables<PendingRequestTable>;

      void sendProds(const psibase::Action& action);

      /// Indicates that the query is not expected to produce an immediate response
      /// Can be called inside `PSIBASE_SUBJECTIVE_TX`
      void deferReply(std::int32_t socket);
      /// Indicates that a reply will be produced by the current transaction/query/callback
      /// Can be called inside `PSIBASE_SUBJECTIVE_TX`
      void claimReply(std::int32_t socket);
      /// Sends a reply
      void sendReply(std::int32_t socket, const psibase::HttpReply& response);

      /// Register sender's subdomain
      ///
      /// When requests to a subdomain cannot be filled by 'sites', then `http-server` will
      /// forward the request into the `serveSys` action of the subdomain's registered `server`
      /// for it to handle the request.
      ///
      /// Registered services may optionally:
      /// * Serve files via HTTP
      /// * Respond to RPC requests
      /// * Respond to GraphQL requests
      void registerServer(psibase::AccountNumber server);
   };
   PSIO_REFLECT(HttpServer,
                method(sendProds, action),
                method(deferReply, socket),
                method(claimReply, socket),
                method(sendReply, socket, response),
                method(registerServer, server))
}  // namespace SystemService
