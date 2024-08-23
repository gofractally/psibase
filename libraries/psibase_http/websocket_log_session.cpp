#include "websocket_log_session.ipp"

#include <boost/beast/websocket.hpp>
#include <psibase/http_types.hpp>

namespace psibase::http
{

   namespace ws = boost::beast::websocket;

   template class websocket_log_session<ws::stream<tcp_stream>>;
#ifdef PSIBASE_ENABLE_SSL
   template class websocket_log_session<ws::stream<ssl_stream>>;
#endif
   template class websocket_log_session<ws::stream<local_stream>>;

}  // namespace psibase::http
