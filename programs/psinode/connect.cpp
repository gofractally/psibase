#include <psibase/http.hpp>

#include "connect.hpp"
#include "connection.hpp"
#include "psinode.hpp"

#include <boost/asio/ssl/host_name_verification.hpp>

using namespace psibase;
using namespace psibase::net;

enum class socket_type
{
   unknown,
   tcp,
   tls,
   local
};

std::tuple<socket_type, std::string_view, std::string_view> parse_endpoint(std::string_view peer)
{
   auto type = socket_type::unknown;
   if (peer.starts_with("ws://"))
   {
      type = socket_type::tcp;
      peer = peer.substr(5);
   }
   else if (peer.starts_with("http://"))
   {
      type = socket_type::tcp;
      peer = peer.substr(7);
   }
   else if (peer.starts_with("wss://"))
   {
      type = socket_type::tls;
      peer = peer.substr(6);
   }
   else if (peer.starts_with("https://"))
   {
      type = socket_type::tls;
      peer = peer.substr(8);
   }
   if (type == socket_type::unknown)
   {
      if (peer.find('/') != std::string::npos)
      {
         return {socket_type::local, peer, ""};
      }
   }
   else
   {
      if (peer.ends_with('/'))
      {
         peer = peer.substr(0, peer.size() - 1);
      }
   }
   auto pos = peer.find(':');
   if (pos == std::string_view::npos)
   {
      return {type, peer, type == socket_type::tls ? "443" : "80"};
   }
   else
   {
      return {type, peer.substr(0, pos), peer.substr(pos + 1)};
   }
}

std::function<void(const std::string& peer, connect_handler&&)> make_connect_one(
    boost::asio::ip::tcp::resolver&           resolver,
    boost::asio::io_context&                  chainContext,
    const std::shared_ptr<http::http_config>& http_config,
    connect_success_callback                  add)
{
   return [&resolver, &chainContext, &http_config, add](const std::string& peer, auto&& f)
   {
      auto [proto, host, service] = parse_endpoint(peer);
      auto on_connect = [&http_config, f = static_cast<decltype(f)>(f), add](std::error_code ec,
                                                                             auto&& conn) mutable
      {
         if (!ec)
         {
            ec = add(std::move(conn));
         }
         f(ec);
      };
      auto do_connect = [&](auto&& conn)
      {
         conn->url = peer;
         async_connect(std::move(conn), resolver, host, service, std::move(on_connect));
      };
      if (proto == socket_type::local)
      {
         auto conn = std::make_shared<
             websocket_connection<boost::beast::basic_stream<boost::asio::local::stream_protocol>>>(
             chainContext);
         conn->url = peer;
         async_connect(std::move(conn), host, std::move(on_connect));
      }
      else if (proto == socket_type::tls)
      {
#if PSIBASE_ENABLE_SSL
         auto conn = std::make_shared<
             websocket_connection<boost::beast::ssl_stream<boost::beast::tcp_stream>>>(
             chainContext, *http_config->tls_context);
         conn->stream.next_layer().set_verify_mode(boost::asio::ssl::verify_peer);
         conn->stream.next_layer().set_verify_callback(
             boost::asio::ssl::host_name_verification(std::string(host)));
         auto ssl_conn = conn->stream.next_layer().native_handle();
         SSL_set_tlsext_host_name(ssl_conn, std::string(host).c_str());
         do_connect(std::move(conn));
#else
         PSIBASE_LOG(psibase::loggers::generic::get(), warning)
             << "Connection to " << peer
             << " not attempted because psinode was built without TLS support";
         boost::asio::post(chainContext, [f = static_cast<decltype(f)>(f)]
                           { f(std::error_code(EPROTONOSUPPORT, std::generic_category())); });
#endif
      }
      else
      {
         do_connect(std::make_shared<websocket_connection<boost::beast::tcp_stream>>(chainContext));
      }
   };
}
