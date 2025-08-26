#pragma once

#include "http_session.hpp"

namespace psibase::http
{

   struct tcp_http_session : public http_session<tcp_http_session>
   {
      tcp_http_session(server_state& server, boost::asio::ip::tcp::socket&& socket);
      ~tcp_http_session();

      void close_impl(boost::beast::error_code& ec) { stream.socket().close(ec); }
      void shutdown_impl() { common_shutdown_impl(); }

      SocketEndpoint remote_endpoint() const;

      boost::beast::tcp_stream stream;
   };

   extern template class http_session<tcp_http_session>;

}  // namespace psibase::http
