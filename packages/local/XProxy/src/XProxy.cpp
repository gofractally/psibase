#include <services/local/XProxy.hpp>

#include <psibase/WebSocket.hpp>
#include <psibase/dispatch.hpp>
#include <psibase/serveGraphQL.hpp>
#include <psibase/webServices.hpp>
#include <services/local/XAdmin.hpp>
#include <services/local/XHttp.hpp>
#include <services/system/HttpServer.hpp>
#include <services/system/RTransact.hpp>

using namespace psibase;
using namespace LocalService;
using namespace SystemService;

namespace
{
   struct Query
   {
      std::vector<OriginServerRow> originServers() const
      {
         std::vector<OriginServerRow> result;
         PSIBASE_SUBJECTIVE_TX
         {
            auto table = XProxy{}.open<OriginServerTable>();
            for (auto row : table.getIndex<0>())
               result.push_back(std::move(row));
         }
         return result;
      }
      PSIO_REFLECT(Query, method(originServers))
   };
}  // namespace

std::optional<HttpReply> XProxy::serveSys(HttpRequest req, std::optional<std::int32_t> socket)
{
   check(getSender() == XHttp::service, "Wrong sender");
   auto target = req.path();

   auto subdomain = XHttp::getService(req);

   if (subdomain == getReceiver())
   {
      if (auto reply = to<XAdmin>().checkAuth(req, socket))
         return reply;

      if (auto result = serveGraphQL(req, Query{}))
         return result;

      if (target == "/set_origin_server")
      {
         if (req.method != "POST")
            return HttpReply::methodNotAllowed(req);
         if (req.contentType != "application/json")
         {
            std::string_view msg = "Content-Type must be application/json\n";
            return HttpReply{
                .status      = HttpStatus::unsupportedMediaType,
                .contentType = "text/html",
                .body        = {msg.begin(), msg.end()},
            };
         }
         auto table = open<OriginServerTable>();
         auto row   = psio::convert_from_json<OriginServerRow>(
             std::string(req.body.begin(), req.body.end()));

         if (row.host.empty() || row.host.find("://") != std::string::npos)
         {
            std::string_view msg{"Invalid host for origin server. Expected host[:port]\n"};
            return HttpReply{
                .status      = HttpStatus::badRequest,
                .contentType = "text/html",
                .body        = {msg.begin(), msg.end()},
            };
         }

         PSIBASE_SUBJECTIVE_TX
         {
            table.put(row);
         }
         return HttpReply{.headers = allowCors()};
      }
   }
   else
   {
      // Try the server registered in HttpServer
      // This allows RPC calls to be handled by the registered server
      if (auto registered = HttpServer::Tables(HttpServer::service, KvMode::read)
                                .open<RegServTable>()
                                .get(subdomain))
      {
         to<XHttp>().giveSocket(*socket, registered->server, false);

         auto user = to<RTransact>().getUser(req);

         // Remove sensitive headers
         req.removeCookie("__HOST-SESSION");
         req.removeCookie("SESSION");
         std::erase_if(req.headers, [](auto& header) { return header.matches("authorization"); });
         auto reply = from(HttpServer::service)
                          .to<ServerInterface>(registered->server)
                          .serveSys(req, socket, user);

         if (!to<XHttp>().takeSocket(*socket, false))
            return {};
         if (reply)
            return reply;
      }
   }

   // Try the upstream server
   auto                           table = open<OriginServerTable>();
   std::optional<OriginServerRow> originServer;
   PSIBASE_SUBJECTIVE_TX
   {
      originServer = table.get(subdomain);
   }
   if (originServer)
   {
      req.host = originServer->host;
      std::int32_t          upstream;
      psibase::MethodNumber callback;
      if (isWebSocketHandshake(req))
      {
         upstream = to<XHttp>().websocket(req, originServer->tls, originServer->endpoint);
         callback = MethodNumber{"onAccept"};
      }
      else
      {
         upstream = to<XHttp>().sendRequest(req, originServer->tls, originServer->endpoint);
         callback = MethodNumber{"onReply"};
      }
      auto requests = open<ProxyTable>();
      PSIBASE_SUBJECTIVE_TX
      {
         to<XHttp>().autoClose(*socket, false);
         to<XHttp>().setCallback(upstream, callback, MethodNumber{"onError"});
         requests.put({upstream, *socket});
      }
   }
   return {};
}

void XProxy::onReply(std::int32_t socket, psibase::HttpReply reply)
{
   check(getSender() == XHttp::service, "Wrong sender");
   auto table = open<ProxyTable>();
   PSIBASE_SUBJECTIVE_TX
   {
      if (auto row = table.get(socket))
      {
         to<XHttp>().autoClose(row->socket2, true);
         to<XHttp>().sendReply(row->socket2, std::move(reply));
         table.remove(*row);
      }
   }
}

void XProxy::onAccept(std::int32_t socket, psibase::HttpReply reply)
{
   check(getSender() == XHttp::service, "Wrong sender");
   auto                    table = open<ProxyTable>();
   auto                    ws    = open<WebSocketTable>();
   std::optional<ProxyRow> row;
   PSIBASE_SUBJECTIVE_TX
   {
      row = table.get(socket);
      if (row)
      {
         to<XHttp>().autoClose(row->socket2, true);
         table.remove(*row);
      }
   }
   if (row)
   {
      to<XHttp>().accept(row->socket2, std::move(reply));
      PSIBASE_SUBJECTIVE_TX
      {
         to<XHttp>().setCallback(row->socket1, MethodNumber{"recv"}, MethodNumber{"close"});
         to<XHttp>().setCallback(row->socket2, MethodNumber{"recv"}, MethodNumber{"close"});
         ws.put({row->socket1, row->socket2});
         ws.put({row->socket2, row->socket1});
      }
   }
}

void XProxy::onError(std::int32_t socket, std::optional<psibase::HttpReply> reply)
{
   check(getSender() == XHttp::service, "Wrong sender");
   auto table = open<ProxyTable>();
   if (!reply)
   {
      std::string_view msg{"Bad Gateway"};
      reply = {.status      = HttpStatus::badGateway,
               .contentType = "text/html",
               .body        = std::vector(msg.begin(), msg.end())};
   }
   PSIBASE_SUBJECTIVE_TX
   {
      if (auto row = table.get(socket))
      {
         to<XHttp>().autoClose(row->socket2, true);
         to<XHttp>().sendReply(row->socket2, std::move(*reply));
         table.remove(*row);
      }
   }
}

void XProxy::close(std::int32_t socket)
{
   check(getSender() == XHttp::service, "Wrong sender");
   auto table = open<WebSocketTable>();
   PSIBASE_SUBJECTIVE_TX
   {
      if (auto row = table.get(socket))
      {
         auto row2 = table.get(row->to);
         check(row2.has_value(),
               "upstream and downstream sockets must be added and removed atomically");
         table.remove(*row);
         table.remove(*row2);
         to<XHttp>().asyncClose(row->to);
      }
   }
}

void XProxy::recv(std::int32_t                        socket,
                  psio::view<const std::vector<char>> data,
                  std::uint32_t                       flags)
{
   check(getSender() == XHttp::service, "Wrong sender");
   auto                        table = open<WebSocketTable>();
   std::optional<WebSocketRow> row;
   PSIBASE_SUBJECTIVE_TX
   {
      row = table.get(socket);
   }
   if (row)
      to<XHttp>().send(row->to, data, flags);
}

PSIBASE_DISPATCH(XProxy)
