#include "unix_http_session.hpp"

#include <boost/beast/websocket.hpp>

namespace psibase::http
{
   namespace
   {
      // The peer of a socket that was never bound has no name. Linux reports that
      // as an empty path. Darwin reports a full-length address whose path is all
      // zero bytes; without this it would be shown (and matched) as a 14-byte name.
      // A Linux abstract name starts with a zero byte followed by its name, so only
      // trailing zero bytes are dropped.
      std::string peerPath(const boost::asio::local::stream_protocol::endpoint& endpoint)
      {
         auto path = endpoint.path();
         while (!path.empty() && path.back() == '\0')
            path.pop_back();
         return path;
      }
   }  // namespace

   SocketEndpoint toSocketEndpoint(const boost::asio::local::stream_protocol::endpoint& endpoint)
   {
      return LocalEndpoint{peerPath(endpoint)};
   }

   unix_http_session::unix_http_session(server_state&                                 server,
                                        boost::asio::local::stream_protocol::socket&& socket)
       : http_session<unix_http_session>(server), stream(std::move(socket))
   {
      logger.add_attribute("RemoteEndpoint", boost::log::attributes::constant<std::string>(
                                                 peerPath(stream.socket().remote_endpoint())));
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

   SocketEndpoint unix_http_session::remote_endpoint() const
   {
      return toSocketEndpoint(stream.socket().remote_endpoint());
   }

   template class http_session<unix_http_session>;
}  // namespace psibase::http
