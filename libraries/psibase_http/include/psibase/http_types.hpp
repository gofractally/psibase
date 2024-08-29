#pragma once

#include <boost/asio/local/stream_protocol.hpp>
#include <boost/beast/core/basic_stream.hpp>
#include <boost/beast/core/tcp_stream.hpp>
#ifdef PSIBASE_ENABLE_SSL
#include <boost/beast/ssl.hpp>
#endif

namespace psibase::http
{
   using tcp_stream = boost::beast::tcp_stream;
#ifdef PSIBASE_ENABLE_SSL
   using ssl_stream = boost::beast::ssl_stream<boost::beast::tcp_stream>;
#endif
   using local_stream = boost::beast::basic_stream<boost::asio::local::stream_protocol>;
}  // namespace psibase::http
