#include "unix_http_session.hpp"

#include <boost/beast/websocket.hpp>

namespace psibase::http
{
   unix_http_session::unix_http_session(server_state&                                 server,
                                        boost::asio::local::stream_protocol::socket&& socket)
       : http_session<unix_http_session>(server), stream(std::move(socket))
   {
      logger.add_attribute("RemoteEndpoint", boost::log::attributes::constant<std::string>(
                                                 stream.socket().remote_endpoint().path()));
   }
   unix_http_session::~unix_http_session() = default;

   void unix_http_session::close_impl(boost::beast::error_code& ec)
   {
      stream.socket().close(ec);
   }
   void unix_http_session::shutdown_impl()
   {
      common_shutdown_impl();
   }

   template class http_session<unix_http_session>;
}  // namespace psibase::http
