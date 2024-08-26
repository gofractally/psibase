#pragma once

#include "http_session.hpp"

namespace psibase::http
{

   struct unix_http_session : public http_session<unix_http_session>
   {
      unix_http_session(server_state& server, boost::asio::local::stream_protocol::socket&& socket);
      ~unix_http_session();

      bool check_access(const authz_loopback& addr) const { return true; }
      bool check_access(const authz_ip& addr) const { return false; }

      void close_impl(boost::beast::error_code& ec);
      void shutdown_impl();

      boost::beast::basic_stream<boost::asio::local::stream_protocol,
                                 boost::asio::any_io_executor,
                                 boost::beast::unlimited_rate_policy>
          stream;
   };

   extern template class http_session<unix_http_session>;
}  // namespace psibase::http
