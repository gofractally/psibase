#pragma once

#include "http_session.hpp"

namespace psibase::http
{

   struct tcp_http_session : public http_session<tcp_http_session>
   {
      tcp_http_session(server_state& server, boost::asio::ip::tcp::socket&& socket);
      ~tcp_http_session();

      bool check_access(const authz_loopback&) const
      {
         return stream.socket().remote_endpoint().address().is_loopback();
      }

      bool check_access(const authz_ip& addr) const
      {
         return stream.socket().remote_endpoint().address() == addr.address;
      }

      void close_impl(boost::beast::error_code& ec) { stream.socket().close(ec); }
      void shutdown_impl() { common_shutdown_impl(); }

      boost::beast::tcp_stream stream;
   };

   extern template class http_session<tcp_http_session>;

}  // namespace psibase::http
