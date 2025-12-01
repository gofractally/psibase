#include "websocket.hpp"

using namespace psibase;
using namespace psibase::http;

namespace
{
   WebSocketInfo toWebSocketInfo(auto&& info)
   {
      abortMessage("Socket cannot be upgraded to a websocket");
   }
   WebSocketInfo toWebSocketInfo(HttpClientSocketInfo&& info)
   {
      return WebSocketInfo{std::move(info.endpoint), std::move(info.tls)};
   }
   WebSocketInfo toWebSocketInfo(HttpSocketInfo&& info)
   {
      return WebSocketInfo{std::move(info.endpoint), std::move(info.tls)};
   }
   WebSocketInfo toWebSocketInfo(SocketInfo&& info)
   {
      return std::visit([](auto&& info) { return toWebSocketInfo(std::move(info)); },
                        std::move(info));
   }
}  // namespace

WebSocket::WebSocket(server_state& server, SocketInfo&& info)
    : server(server), savedInfo(toWebSocketInfo(std::move(info)))
{
   logger.add_attribute("Channel", boost::log::attributes::constant(std::string("http")));
   if (savedInfo.endpoint)
   {
      logger.add_attribute("RemoteEndpoint", boost::log::attributes::constant<std::string>(
                                                 to_string(*savedInfo.endpoint)));
   }
}
