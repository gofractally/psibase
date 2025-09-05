#pragma once

#include "http_session.hpp"

#ifdef PSIBASE_ENABLE_SSL

#include <boost/beast/ssl.hpp>

namespace psibase::http
{

   struct tls_http_session : public http_session<tls_http_session>
   {
      tls_http_session(server_state& server, boost::asio::ip::tcp::socket&& socket);

      virtual bool is_secure() const override { return true; }

      void shutdown_impl();
      void close_impl(boost::beast::error_code& ec);

      SocketEndpoint remote_endpoint() const;

      void run();

      tls_context_ptr                                    context;
      boost::beast::ssl_stream<boost::beast::tcp_stream> stream;
   };

   extern template class http_session<tls_http_session>;

}  // namespace psibase::http

#endif
