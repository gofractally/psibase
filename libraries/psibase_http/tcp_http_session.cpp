#include "tcp_http_session.hpp"

#include <boost/beast/websocket.hpp>

namespace psibase::http
{
   SocketEndpoint toSocketEndpoint(const boost::asio::ip::tcp::endpoint& endpoint)
   {
      auto address = endpoint.address();
      if (address.is_v4())
      {
         auto         v4 = address.to_v4();
         IPV4Endpoint result{.port = endpoint.port()};
         std::ranges::copy(v4.to_bytes(), result.address.bytes.begin());
         return result;
      }
      else
      {
         auto         v6 = address.to_v6();
         IPV6Endpoint result{.address = {.zone = v6.scope_id()}, .port = endpoint.port()};
         std::ranges::copy(v6.to_bytes(), result.address.bytes.begin());
         return result;
      }
   }

   tcp_http_session::tcp_http_session(server_state& server, boost::asio::ip::tcp::socket&& socket)
       : http_session<tcp_http_session>(server), stream(std::move(socket))
   {
      std::ostringstream ss;
      ss << stream.socket().remote_endpoint();
      logger.add_attribute("RemoteEndpoint",
                           boost::log::attributes::constant<std::string>(ss.str()));
   }

   SocketEndpoint tcp_http_session::remote_endpoint() const
   {
      return toSocketEndpoint(stream.socket().remote_endpoint());
   }

   tcp_http_session::~tcp_http_session() = default;
   template class http_session<tcp_http_session>;
}  // namespace psibase::http
