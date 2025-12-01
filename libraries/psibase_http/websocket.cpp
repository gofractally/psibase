#include "websocket.hpp"

using namespace psibase;
using namespace psibase::http;

namespace
{
   SocketInfo toWebSocketInfo(auto&& info)
   {
      abortMessage("Socket cannot be upgraded to a websocket");
   }
   SocketInfo toWebSocketInfo(HttpClientSocketInfo&& info)
   {
      return WebSocketInfo{std::move(info.endpoint), std::move(info.tls)};
   }
   SocketInfo toWebSocketInfo(HttpSocketInfo&& info)
   {
      return WebSocketInfo{std::move(info.endpoint), std::move(info.tls)};
   }
   SocketInfo toWebSocketInfo(SocketInfo&& info)
   {
      return std::visit([](auto&& info) { return toWebSocketInfo(std::move(info)); },
                        std::move(info));
   }
}  // namespace

WebSocket::WebSocket(server_state& server, SocketInfo&& info)
    : server(server), savedInfo(toWebSocketInfo(std::move(info)))
{
}
