#include <psibase/Rpc.hpp>
#include <psibase/Service.hpp>
#include <psibase/WebSocket.hpp>
#include <psibase/dispatch.hpp>
#include <services/local/XAdmin.hpp>
#include <services/local/XHttp.hpp>

using namespace psibase;
using namespace LocalService;

void spinFor(std::chrono::steady_clock::duration duration)
{
   auto end = std::chrono::steady_clock::now() + duration;
   while (std::chrono::steady_clock::now() < end)
   {
   }
}

struct OriginServerRow
{
   std::string                   host;
   std::optional<TLSInfo>        tls;
   std::optional<SocketEndpoint> endpoint;
   std::optional<MicroSeconds>   spin;
   PSIO_REFLECT(OriginServerRow, host, tls, endpoint, spin)
};
using OriginServerTable = psibase::Table<OriginServerRow, SingletonKey{}>;
PSIO_REFLECT_TYPENAME(OriginServerTable)

struct ProxyRow
{
   std::int32_t socket1;
   std::int32_t socket2;
   PSIO_REFLECT(ProxyRow, socket1, socket2)
};
using ProxyTable = psibase::Table<ProxyRow, &ProxyRow::socket1>;
PSIO_REFLECT_TYPENAME(ProxyTable)

struct WebSocketRow
{
   std::int32_t from;
   std::int32_t to;
   PSIO_REFLECT(WebSocketRow, from, to)
};
using WebSocketTable = psibase::Table<WebSocketRow, &WebSocketRow::from, &WebSocketRow::to>;
PSIO_REFLECT_TYPENAME(WebSocketTable)

struct XProxy : psibase::Service
{
   static constexpr auto service = psibase::AccountNumber{"x-proxy"};
   using Subjective              = psibase::SubjectiveTables<OriginServerTable>;
   using Session                 = psibase::SessionTables<ProxyTable, WebSocketTable>;

   std::optional<HttpReply> serveSys(HttpRequest req, std::optional<std::int32_t> socket);
   void                     onReply(std::int32_t socket, psibase::HttpReply reply);
   void                     onAccept(std::int32_t socket, psibase::HttpReply reply);
   void                     onError(std::int32_t socket, std::optional<psibase::HttpReply> reply);
   void                     recv(std::int32_t socket, psio::view<const std::vector<char>> data);
   void                     close(std::int32_t socket);
};
PSIO_REFLECT(XProxy,
             method(serveSys, request, socket),
             method(onReply, socket, reply),
             method(onAccept, socket, reply),
             method(onError, socket, reply),
             method(recv, socket, data),
             method(close, socket))
PSIBASE_REFLECT_TABLES(XProxy, XProxy::Subjective, XProxy::Session)

std::optional<HttpReply> XProxy::serveSys(HttpRequest req, std::optional<std::int32_t> socket)
{
   check(getSender() == XHttp::service, "Wrong sender");
   auto target = req.path();

   if (target == "/set_origin_server")
   {
      if (auto reply = to<XAdmin>().checkAuth(req, socket))
         return reply;
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
      auto row =
          psio::convert_from_json<OriginServerRow>(std::string(req.body.begin(), req.body.end()));
      PSIBASE_SUBJECTIVE_TX
      {
         table.put(row);
      }
      return HttpReply{};
   }
   else
   {
      auto                           table = open<OriginServerTable>();
      std::optional<OriginServerRow> originServer;
      PSIBASE_SUBJECTIVE_TX
      {
         originServer = table.get({});
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
         if (originServer->spin)
            spinFor(*originServer->spin);
         auto requests = open<ProxyTable>();
         PSIBASE_SUBJECTIVE_TX
         {
            to<XHttp>().autoClose(*socket, false);
            to<XHttp>().setCallback(upstream, callback, MethodNumber{"onError"});
            requests.put({upstream, *socket});
         }
         return {};
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
         to<XHttp>().close(row->to);
      }
   }
}

void XProxy::recv(std::int32_t socket, psio::view<const std::vector<char>> data)
{
   check(getSender() == XHttp::service, "Wrong sender");
   auto                        table = open<WebSocketTable>();
   std::optional<WebSocketRow> row;
   PSIBASE_SUBJECTIVE_TX
   {
      row = table.get(socket);
   }
   if (row)
      to<XHttp>().send(row->to, data);
}

PSIBASE_DISPATCH(XProxy)
