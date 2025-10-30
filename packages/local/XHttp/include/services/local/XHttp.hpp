#pragma once

#include <psibase/Service.hpp>
#include <psibase/Table.hpp>
#include <services/system/HttpServer.hpp>

namespace LocalService
{
   using SystemService::PendingRequestRow;
   using SystemService::PendingRequestTable;

   struct ResponseHandlerRow
   {
      std::int32_t           socket;
      psibase::AccountNumber service;
      psibase::MethodNumber  method;
      PSIO_REFLECT(ResponseHandlerRow, socket, service, method)
   };
   using ResponseHandlerTable = psibase::Table<ResponseHandlerRow, &ResponseHandlerRow::socket>;
   PSIO_REFLECT_TYPENAME(ResponseHandlerTable)

   struct XHttp : psibase::Service
   {
      static constexpr auto service = psibase::AccountNumber{"x-http"};

      using Session = psibase::SessionTables<PendingRequestTable, ResponseHandlerTable>;

      static psibase::AccountNumber getService(std::string_view host, std::string_view rootHost)
      {
         if (host.size() > rootHost.size() + 1 && host.ends_with(rootHost) &&
             host[host.size() - rootHost.size() - 1] == '.')
         {
            std::string_view serviceName(host);
            serviceName.remove_suffix(rootHost.size() + 1);
            return psibase::AccountNumber{serviceName};
         }
         return {};
      }
      static psibase::AccountNumber getService(const psibase::HttpRequest& req);
      static psibase::AccountNumber getService(psio::view<const psibase::HttpRequest> req);

      /// Sends a message to a socket. HTTP sockets should use sendReply, instead.
      void send(std::int32_t socket, psio::view<const std::vector<char>> data);

      /// Sends an HTTP request. When the response is available, it
      /// will be passed to `sender::callback(socket, reply)`
      ///
      /// Returns the new socket
      ///
      /// TODO: decide how to report connection errors
      std::int32_t sendRequest(psibase::HttpRequest request, psibase::MethodNumber callback);

      /// Enables or disables automatic closing of the socket
      /// when the transaction context exits.
      ///
      /// Can be called inside `PSIBASE_SUBJECTIVE_TX`
      void autoClose(std::int32_t socket, bool value);

      /// Sends an HTTP response. The socket must have autoClose enabled.
      void sendReply(std::int32_t socket, const psibase::HttpReply& response);

      /// Returns the root host for a given host
      std::string rootHost(psio::view<const std::string> host);

      /// Called by the host at the beginning of a session
      void startSession();
   };
   PSIO_REFLECT(XHttp,
                method(send, socket, data),
                method(sendRequest, request, callback),
                method(autoClose, socket, value),
                method(sendReply, socket, response),
                method(rootHost, host),
                method(startSession))

   PSIBASE_REFLECT_TABLES(XHttp, XHttp::Session)

   inline psibase::AccountNumber XHttp::getService(const psibase::HttpRequest& req)
   {
      return getService(req.host, psibase::to<XHttp>().rootHost(req.host));
   }
   inline psibase::AccountNumber XHttp::getService(psio::view<const psibase::HttpRequest> req)
   {
      return getService(req.host(), psibase::to<XHttp>().rootHost(req.host()));
   }

}  // namespace LocalService
