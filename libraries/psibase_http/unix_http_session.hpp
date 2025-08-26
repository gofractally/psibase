#pragma once

#include "http_session.hpp"

namespace psibase::http
{

   struct unix_http_session : public http_session<unix_http_session>
   {
      unix_http_session(server_state& server, boost::asio::local::stream_protocol::socket&& socket);
      ~unix_http_session();

      void close_impl(boost::beast::error_code& ec);
      void shutdown_impl();

      SocketEndpoint remote_endpoint() const;

      boost::beast::basic_stream<boost::asio::local::stream_protocol,
                                 boost::asio::any_io_executor,
                                 boost::beast::unlimited_rate_policy>
          stream;
   };

   extern template class http_session<unix_http_session>;
}  // namespace psibase::http
