#include <psibase/Service.hpp>
#include <psibase/WebSocket.hpp>
#include <psibase/dispatch.hpp>
#include <services/local/XHttp.hpp>

struct WSEcho : psibase::Service
{
   static constexpr auto service = psibase::AccountNumber{"x-echo"};
   void                  recv(std::int32_t socket, psio::view<const std::vector<char>> data);
   void                  close(std::int32_t socket);
   std::optional<psibase::HttpReply> serveSys(psibase::HttpRequest        request,
                                              std::optional<std::int32_t> socket);
};
PSIO_REFLECT(WSEcho,
             method(recv, socket, data),
             method(close, socket),
             method(serveSys, request, socket))

using namespace psibase;
using namespace LocalService;

std::optional<HttpReply> WSEcho::serveSys(HttpRequest request, std::optional<std::int32_t> socket)
{
   check(getSender() == XHttp::service, "Wrong sender");
   auto target = request.path();
   if (target == "/echo")
   {
      if (auto reply = webSocketHandshake(request))
      {
         to<XHttp>().accept(*socket, *reply);
         to<XHttp>().setCallback(*socket, MethodNumber{"recv"}, MethodNumber{"close"});
      }
      else
      {
         std::string_view msg = "/echo is a websocket endpoint";
         return HttpReply{
             .status      = HttpStatus::upgradeRequired,
             .contentType = "application/html",
             .body{msg.begin(), msg.end()},
             .headers = {{"Upgrade", "websocket"}},
         };
      }
   }
   return {};
}

void WSEcho::close(std::int32_t socket) {}

void WSEcho::recv(std::int32_t socket, psio::view<const std::vector<char>> data)
{
   check(getSender() == XHttp::service, "Wrong sender");
   to<XHttp>().send(socket, data);
}

PSIBASE_DISPATCH(WSEcho)
