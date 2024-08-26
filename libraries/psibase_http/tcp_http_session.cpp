#include "tcp_http_session.hpp"

#include <boost/beast/websocket.hpp>

namespace psibase::http
{

   tcp_http_session::tcp_http_session(server_state& server, boost::asio::ip::tcp::socket&& socket)
       : http_session<tcp_http_session>(server), stream(std::move(socket))
   {
      std::ostringstream ss;
      ss << stream.socket().remote_endpoint();
      logger.add_attribute("RemoteEndpoint",
                           boost::log::attributes::constant<std::string>(ss.str()));
   }

   tcp_http_session::~tcp_http_session() = default;
   template class http_session<tcp_http_session>;
}  // namespace psibase::http
