#include <services/local/XPeers.hpp>

#include <psibase/WebSocket.hpp>
#include <psibase/dispatch.hpp>
#include <services/local/XAdmin.hpp>
#include <services/local/XHttp.hpp>

using namespace psibase;
using namespace LocalService;

namespace
{
   struct ConnectRequest
   {
      std::string url;
      PSIO_REFLECT(ConnectRequest, url)
   };

   std::int32_t connect(std::string peer)
   {
      std::optional<TLSInfo>        tls;
      std::optional<SocketEndpoint> endpoint;
      auto                          url = splitURL(peer);
      HttpRequest                   request{
                            .method = "GET",
                            .target = "/p2p",
      };
      if (url.scheme == "https" || url.scheme == "wss")
      {
         tls.emplace();
         request.host = url.host;
      }
      else if (url.scheme == "http" || url.scheme == "ws")
      {
         request.host = url.host;
      }
      else if (peer.find('/') == std::string::npos)
      {
         request.host = peer;
      }
      else
      {
         request.host = "localhost";
         endpoint     = LocalEndpoint{peer};
      }
      std::int32_t socket = to<XHttp>().websocket(request, std::move(tls), std::move(endpoint));
      return socket;
   }
}  // namespace

auto XPeers::serveSys(const HttpRequest& request, std::optional<std::int32_t> socket)
    -> std::optional<HttpReply>
{
   check(getSender() == XHttp::service, "Wrong sender");
   if (auto reply = to<XAdmin>().checkAuth(request, socket))
      return reply;

   auto target = request.path();
   if (target == "/connect")
   {
      if (request.contentType != "application/json")
      {
         std::string_view msg{"Content-Type must be application/json"};
         return HttpReply{.status      = HttpStatus::unsupportedMediaType,
                          .contentType = "application/html",
                          .body{msg.begin(), msg.end()}};
      }
      if (request.method != "POST")
         return HttpReply::methodNotAllowed(request);
      auto body = psio::convert_from_json<ConnectRequest>(
          std::string(request.body.begin(), request.body.end()));
      std::int32_t newSocket = connect(body.url);

      auto connectionRequests = open<ConnectionRequestTable>();
      PSIBASE_SUBJECTIVE_TX
      {
         to<XHttp>().setCallback(newSocket, MethodNumber{"onP2P"}, MethodNumber{"errP2P"});
         connectionRequests.put({newSocket, *socket});
         to<XHttp>().autoClose(*socket, false);
      }
      return {};
   }
   if (target == "/p2p")
   {
      if (auto reply = webSocketHandshake(request))
      {
         to<XHttp>().accept(*socket, *reply, MethodNumber{"recvP2P"}, MethodNumber{"closeP2P"});
         PSIBASE_SUBJECTIVE_TX
         {
            auto  table   = Native::session().open<SocketTable>();
            auto  row     = table.get(*socket).value();
            auto& oldInfo = std::get<WebSocketInfo>(row.info);
            row.info      = P2PSocketInfo{std::move(oldInfo.endpoint), std::move(oldInfo.tls)};
            table.put(row);
         }
      }
   }
   return {};
}

void XPeers::onP2P(std::int32_t socket, HttpReply reply)
{
   std::optional<ConnectionRequestRow> request;
   // convert to p2p socket
   auto connectionRequests = open<ConnectionRequestTable>();
   PSIBASE_SUBJECTIVE_TX
   {
      auto  table   = Native::session().open<SocketTable>();
      auto  row     = table.get(socket).value();
      auto& oldInfo = std::get<WebSocketInfo>(row.info);
      row.info      = P2PSocketInfo{std::move(oldInfo.endpoint), std::move(oldInfo.tls)};
      table.put(row);
      to<XHttp>().setCallback(socket, MethodNumber{"recvP2P"}, MethodNumber{"closeP2P"});
      request = connectionRequests.get(socket);
      if (request)
      {
         connectionRequests.remove(*request);
         to<XHttp>().autoClose(request->requestSocket, true);
      }
   }
   if (request)
   {
      to<XHttp>().sendReply(request->requestSocket, HttpReply{});
   }
}

void XPeers::errP2P(std::int32_t socket, std::optional<HttpReply> reply)
{
   std::optional<ConnectionRequestRow> request;
   auto                                connectionRequests = open<ConnectionRequestTable>();
   PSIBASE_SUBJECTIVE_TX
   {
      request = connectionRequests.get(socket);
      if (request)
      {
         connectionRequests.remove(*request);
         to<XHttp>().autoClose(request->requestSocket, true);
      }
   }
   if (request)
   {
      std::string_view msg{"Could not open p2p connection"};
      to<XHttp>().sendReply(request->requestSocket, HttpReply{.status      = HttpStatus::badRequest,
                                                              .contentType = "text/html",
                                                              .body{msg.begin(), msg.end()}});
   }
}

void XPeers::recvP2P(std::int32_t socket, psio::view<const std::vector<char>> data) {}

void XPeers::closeP2P(std::int32_t socket) {}

PSIBASE_DISPATCH(XPeers)
