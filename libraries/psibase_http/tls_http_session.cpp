#ifdef PSIBASE_ENABLE_SSL

#include "tls_http_session.hpp"

#include <boost/beast/websocket.hpp>

namespace beast = boost::beast;

namespace psibase::http
{
   SocketEndpoint toSocketEndpoint(const boost::asio::ip::tcp::endpoint& endpoint);

   tls_http_session::tls_http_session(server_state& server, boost::asio::ip::tcp::socket&& socket)
       : http_session<tls_http_session>(server),
         context(server.http_config->tls_context),
         stream(std::move(socket), *context)
   {
      std::ostringstream ss;
      ss << stream.next_layer().socket().remote_endpoint();
      logger.add_attribute("RemoteEndpoint",
                           boost::log::attributes::constant<std::string>(ss.str()));
   }

   void tls_http_session::shutdown_impl()
   {
      stream.async_shutdown([self = shared_from_this()](const std::error_code& ec) {});
   }

   void tls_http_session::close_impl(beast::error_code& ec)
   {
      stream.next_layer().socket().close(ec);
   }

   void tls_http_session::run()
   {
      stream.async_handshake(boost::asio::ssl::stream_base::server,
                             [self = shared_from_this()](const std::error_code& ec)
                             {
                                if (!ec)
                                {
                                   self->http_session<tls_http_session>::run();
                                }
                             });
   }

   SocketEndpoint tls_http_session::remote_endpoint() const
   {
      return toSocketEndpoint(stream.next_layer().socket().remote_endpoint());
   }

   template class http_session<tls_http_session>;
}  // namespace psibase::http

#endif
