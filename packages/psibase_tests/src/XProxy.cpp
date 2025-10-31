#include <psibase/Rpc.hpp>
#include <psibase/Service.hpp>
#include <psibase/dispatch.hpp>
#include <services/local/XHttp.hpp>

using namespace psibase;
using namespace LocalService;

struct OriginServerRow
{
   std::string                   host;
   std::optional<TLSInfo>        tls;
   std::optional<SocketEndpoint> endpoint;
   PSIO_REFLECT(OriginServerRow, host, tls, endpoint)
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

struct XProxy : psibase::Service
{
   static constexpr auto service = psibase::AccountNumber{"x-proxy"};
   using Subjective              = psibase::SubjectiveTables<OriginServerTable>;
   using Session                 = psibase::SessionTables<ProxyTable>;

   std::optional<HttpReply> serveSys(HttpRequest req, std::optional<std::int32_t> socket);
   void                     onReply(std::int32_t socket, psibase::HttpReply reply);
};
PSIO_REFLECT(XProxy, method(serveSys, request, socket), method(onReply, socket, reply))
PSIBASE_REFLECT_TABLES(XProxy, XProxy::Subjective, XProxy::Session)

std::optional<HttpReply> XProxy::serveSys(HttpRequest req, std::optional<std::int32_t> socket)
{
   check(getSender() == XHttp::service, "Wrong sender");
   auto target = req.path();

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
         req.host      = originServer->host;
         auto upstream = to<XHttp>().sendRequest(req, MethodNumber{"onReply"}, originServer->tls,
                                                 originServer->endpoint);
         auto requests = open<ProxyTable>();
         PSIBASE_SUBJECTIVE_TX
         {
            to<XHttp>().autoClose(*socket, false);
            requests.put({upstream, *socket});
         }
         return {};
      }
   }
   return {};
}

void XProxy::onReply(std::int32_t socket, psibase::HttpReply reply)
{
   auto table = open<ProxyTable>();
   PSIBASE_SUBJECTIVE_TX
   {
      if (auto row = table.get(socket))
      {
         to<XHttp>().autoClose(row->socket2, true);
         to<XHttp>().sendReply(row->socket2, std::move(reply));
      }
   }
}

PSIBASE_DISPATCH(XProxy)
