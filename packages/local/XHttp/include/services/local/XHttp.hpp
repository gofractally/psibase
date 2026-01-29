#pragma once

#include <psibase/Service.hpp>
#include <psibase/SocketInfo.hpp>
#include <psibase/Table.hpp>
#include <services/system/HttpServer.hpp>

namespace LocalService
{
   using SystemService::PendingRequestRow;
   using SystemService::PendingRequestTable;

   enum class SocketType : std::uint8_t
   {
      http,
      handshake,
      websocket,
   };

   struct ResponseHandlerRow
   {
      std::int32_t           socket;
      SocketType             type;
      psibase::AccountNumber service;
      psibase::MethodNumber  method;
      psibase::MethodNumber  err;
      PSIO_REFLECT(ResponseHandlerRow, socket, type, service, method, err)
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

      /// Sends an HTTP request and returns the new socket.
      ///
      /// Must be followed by `setCallback(socket, callback, err)`, or the
      /// socket will be closed when the current context exits. When the response
      /// is available, it will be passed to `sender::callback(socket, reply)`.
      /// If the the request fails without a response, calls `sender::err(socket)`
      std::int32_t sendRequest(psibase::HttpRequest                   request,
                               std::optional<psibase::TLSInfo>        tls,
                               std::optional<psibase::SocketEndpoint> endpoint);

      /// Opens a websocket connection and returns the new socket.
      ///
      /// Must be followed by `setCallback(socket, callback, err)`, or the
      /// socket will be closed when the current context exits. The
      /// request method must be GET. The required headers for the websocket
      /// handshake will be added to the request if they are not already
      /// provided. If the connection is successfully established, calls
      /// `sender::callback(socket, reply)`. If the request fails without
      /// a response, calls `sender::err(socket, nullopt)`. If the response
      /// does not complete a websocket handshake, calls
      /// `sender::err(socket, optional(reply))`
      std::int32_t websocket(psibase::HttpRequest                   request,
                             std::optional<psibase::TLSInfo>        tls,
                             std::optional<psibase::SocketEndpoint> endpoint);

      /// Enables or disables automatic closing of the socket
      /// when the transaction context exits.
      ///
      /// Can be called inside `PSIBASE_SUBJECTIVE_TX`
      void autoClose(std::int32_t socket, bool value);

      /// Sends an HTTP response. The socket must have autoClose enabled.
      void sendReply(std::int32_t socket, const psibase::HttpReply& response);

      /// Accepts a websocket connection. The response must be a
      /// valid websocket handshake for the request. Must be
      /// followed by `setCallback(socket, callback, err)`, or the
      /// socket will be closed when the current context exits.
      void accept(std::int32_t socket, const psibase::HttpReply& reply);

      /// Changes the callbacks for a socket. The sender must be the owner
      /// of the socket.
      ///
      /// Can be called inside `PSIBASE_SUBJECTIVE_TX`
      void setCallback(std::int32_t          socket,
                       psibase::MethodNumber callback,
                       psibase::MethodNumber err);

      /// Close a socket. The socket should be either a websocket
      /// or a pending http request.
      void close(std::int32_t socket);

      /// Returns the root host for a given host
      std::string rootHost(psio::view<const std::string> host);

      /// Called by the host at the beginning of a session
      void startSession();
   };
   PSIO_REFLECT(XHttp,
                method(send, socket, data),
                method(sendRequest, request, tls, endpoint),
                method(websocket, request, tls, endpoint),
                method(autoClose, socket, value),
                method(sendReply, socket, response),
                method(accept, socket, reply, callback, err),
                method(setCallback, socket, callback, err),
                method(close, socket),
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
