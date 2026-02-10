#include "send_request.hpp"
#include "websocket.hpp"

#include <boost/asio/io_context.hpp>
#include <boost/asio/ip/tcp.hpp>
#include <boost/asio/local/stream_protocol.hpp>
#include <boost/asio/ssl/host_name_verification.hpp>
#include <boost/asio/strand.hpp>
#include <boost/beast/core.hpp>
#include <boost/beast/http.hpp>
#include <boost/beast/ssl.hpp>
#include <boost/beast/websocket/stream.hpp>
#include <psibase/BlockContext.hpp>
#include <psibase/Rpc.hpp>
#include <psibase/Socket.hpp>
#include <psibase/SocketInfo.hpp>
#include <psibase/TransactionContext.hpp>
#include <psibase/WebSocket.hpp>
#include <psibase/http.hpp>
#include <psibase/serviceEntry.hpp>
#include <psio/finally.hpp>
#include "server_state.hpp"

namespace bhttp = boost::beast::http;
namespace beast = boost::beast;
using namespace psibase;
using namespace psibase::http;

using local_stream = boost::beast::basic_stream<boost::asio::local::stream_protocol,
                                                boost::asio::any_io_executor,
                                                boost::beast::unlimited_rate_policy>;

namespace psibase::http
{
   SocketEndpoint toSocketEndpoint(const boost::asio::ip::tcp::endpoint& endpoint);
   SocketEndpoint toSocketEndpoint(const boost::asio::local::stream_protocol::endpoint& endpoint);

   std::pair<beast::string_view, beast::string_view> split_port(beast::string_view host);
   struct completed_handshake
   {
   };
}  // namespace psibase::http

// This is a hack to allow constructing constructing a websocket with
// the handshake already completed.
#define COMPLETED_HANDSHAKE(Stream)                                                               \
   template <>                                                                                    \
   template <>                                                                                    \
   boost::beast::websocket::stream<Stream>::stream(                                               \
       completed_handshake&&, Stream&& s, const HttpRequest& request,                             \
       bhttp::response<bhttp::vector_body<char>>&& reply, boost::beast::flat_buffer& buffer)      \
       : stream(std::move(s))                                                                     \
   {                                                                                              \
      if (buffer.size() > impl_->rd_buf.capacity())                                               \
         throw std::runtime_error("Internal error: websocket buffer too large");                  \
      impl_->rd_buf.commit(                                                                       \
          boost::asio::buffer_copy(impl_->rd_buf.prepare(buffer.size()), buffer.data()));         \
      boost::beast::websocket::response_type response{                                            \
          reply.result(), reply.version(), std::string(reply.body().begin(), reply.body().end()), \
          static_cast<bhttp::fields&&>(reply)};                                                   \
      error_code       ec;                                                                        \
      std::string_view key = request.getHeader("Sec-WebSocket-Key").value();                      \
      impl_->on_response(response, {key.begin(), key.end()}, ec);                                 \
      if (ec)                                                                                     \
         throw std::system_error(ec);                                                             \
   }

COMPLETED_HANDSHAKE(boost::beast::tcp_stream)
COMPLETED_HANDSHAKE(local_stream)
COMPLETED_HANDSHAKE(boost::beast::ssl_stream<boost::beast::tcp_stream>)

namespace
{
   static constexpr bool isSecure(const auto&)
   {
      return false;
   }
   template <typename Stream>
   static constexpr bool isSecure(const boost::beast::ssl_stream<Stream>&)
   {
      return true;
   }
   template <typename Stream>
   struct HttpClientSocket : AutoCloseSocket, std::enable_shared_from_this<HttpClientSocket<Stream>>
   {
      template <typename... A>
      explicit HttpClientSocket(boost::asio::io_context& context, server_state& server, A&&... a)
          : stream(boost::asio::make_strand(context), std::forward<A>(a)...), server(server)
      {
      }
      void do_write(std::shared_ptr<HttpClientSocket>&& self, HttpRequest&& req)
      {
         auto requestPtr = std::make_shared<bhttp::request<bhttp::vector_body<char>>>();
         if (isWebSocketHandshake(req))
         {
            // TODO: pass through any extensions that we recognize
            req.removeHeader("Sec-WebSocket-Extensions");
            this->request = std::make_shared<HttpRequest>(req);
         }
         auto& request = *requestPtr;
         request.method_string(req.method);
         request.target(std::move(req.target));
         request.version(11);
         request.set(bhttp::field::host, req.host);
         if (!req.contentType.empty())
            request.set(bhttp::field::content_type, req.contentType);
         for (auto& [name, value] : req.headers)
            request.insert(name, value);
         request.body() = std::move(req.body);
         bhttp::async_write(stream, request,
                            [self = std::move(self), _ = std::move(requestPtr)](
                                const std::error_code& ec, std::size_t bytes_transferred)
                            {
                               if (ec)
                               {
                                  PSIBASE_LOG(self->logger, warning) << "Failed to send request";
                                  get_lowest_layer(self->stream).cancel();
                               }
                            });
      }
      void do_read(std::shared_ptr<HttpClientSocket>&& self)
      {
         // Apply a reasonable limit to the allowed size
         // of the body in bytes to prevent abuse.
         parser.body_limit(server.http_config->max_request_size);
         // Read a request using the parser-oriented interface
         boost::beast::http::async_read(
             stream, buffer, parser,
             [self = std::move(self)](const std::error_code& ec,
                                      std::size_t            bytes_transferred) mutable
             {
                if (ec)
                {
                   PSIBASE_LOG(self->logger, warning)
                       << "Failed to read HTTP response: " << ec.message();
                   self->do_error(ec);
                }
                else
                {
                   if (auto l = self->server.sharedState->sockets()->lockRecv(self))
                      do_recv(std::move(l), std::move(self));
                }
             });
      }
      // Must hold the auto close lock before calling this
      static void do_recv(CloseLock&& l, std::shared_ptr<HttpClientSocket>&& self)
      {
         auto system = self->server.sharedState->getSystemContext();

         psio::finally f{[&]() { self->server.sharedState->addSystemContext(std::move(system)); }};
         BlockContext  bc{*system, system->sharedDatabase.getHead(),
                         system->sharedDatabase.createWriter(), true};
         bc.start();

         self->writeInfo(*bc.writer);

         SignedTransaction trx;
         TransactionTrace  trace;

         TransactionContext tc{bc, trx, trace, DbMode::rpc()};

         system->sockets->setOwner(std::move(l), &tc.ownedSockets);

         auto breply = self->parser.get();

         HttpReply reply{
             .status      = static_cast<HttpStatus>(breply.result_int()),
             .contentType = breply[bhttp::field::content_type],
             .body        = breply.body(),
         };

         for (auto&& header : breply)
         {
            reply.headers.push_back(
                HttpHeader{std::string(header.name_string()), std::string(header.value())});
         }

         Action action{
             .sender  = AccountNumber(),
             .service = proxyServiceNum,
             .rawData = psio::convert_to_frac(std::tuple(self->id, psio::to_frac(reply))),
         };

         if (self->request && isWebSocketHandshake(*self->request, reply))
         {
            auto               newSocket = std::make_shared<WebSocket>(self->server, self->info());
            const HttpRequest& req       = *self->request;
            // TODO: We must wait for the request to be completely sent before moving
            // the stream.
            auto impl = std::make_unique<WebSocketImpl<boost::beast::websocket::stream<Stream>>>(
                boost::beast::websocket::stream<Stream>(completed_handshake{},
                                                        std::move(self->stream), req,
                                                        std::move(breply), self->buffer));
            auto cl = system->sockets->lockClose(self);
            self->replace(*bc.writer, newSocket);
            WebSocket::setImpl(cl, std::move(newSocket), std::move(impl));
         }

         try
         {
            auto& atrace = trace.actionTraces.emplace_back();
            tc.execExport("recv", std::move(action), atrace);
            BOOST_LOG_SCOPED_LOGGER_TAG(bc.trxLogger, "Trace", std::move(trace));
            PSIBASE_LOG(bc.trxLogger, debug) << action.service.str() << "::recv succeeded";
         }
         catch (std::exception& e)
         {
            BOOST_LOG_SCOPED_LOGGER_TAG(bc.trxLogger, "Trace", std::move(trace));
            PSIBASE_LOG(bc.trxLogger, warning)
                << action.service.str() << "::recv failed: " << e.what();
         }
      }
      void do_error(const std::error_code& ec) { server.sharedState->sockets()->asyncClose(*this); }
      virtual void send(Writer&, std::span<const char>) override
      {
         abortMessage("Cannot send additional requests through a client socket");
      }
      virtual SocketInfo info() const override { return savedInfo; }
      virtual void       onClose(const std::optional<std::string>& message) noexcept override
      {
         boost::asio::post(stream.get_executor(), [self = this->shared_from_this()]
                           { callClose(self->server, self->logger, *self); });
      }
      virtual void onLock(CloseLock&& l) override
      {
         boost::asio::post(stream.get_executor(),
                           [l = std::move(l), self = this->shared_from_this()]() mutable
                           { do_recv(std::move(l), std::move(self)); });
      }
      Stream                                                                     stream;
      server_state&                                                              server;
      HttpClientSocketInfo                                                       savedInfo;
      boost::beast::http::response_parser<boost::beast::http::vector_body<char>> parser;
      boost::beast::flat_buffer                                                  buffer;
      psibase::loggers::common_logger                                            logger;
      // This is only set if the request looks like a websocket upgrade
      std::shared_ptr<HttpRequest> request;
   };

   struct StringEndpoint
   {
      std::string_view                                host;
      std::shared_ptr<boost::asio::ip::tcp::resolver> resolver;
   };

   template <typename Stream, typename E, typename F>
   void do_connect(std::shared_ptr<HttpClientSocket<Stream>>&& socket, E&& endpoints, F&& next)
   {
      auto& sock = get_lowest_layer(socket->stream);
      sock.async_connect(std::forward<E>(endpoints),
                         [socket = std::move(socket), next = std::forward<F>(next)](
                             const std::error_code& ec) mutable { next(ec, std::move(socket)); });
   }

   template <typename Stream, typename E, typename F>
   void do_connect_resolved(std::shared_ptr<HttpClientSocket<Stream>>&& socket,
                            E&&                                         endpoints,
                            F&&                                         next)
   {
      auto& sock = get_lowest_layer(socket->stream);
      sock.async_connect(std::forward<E>(endpoints),
                         [socket = std::move(socket), next = std::forward<F>(next)](
                             const std::error_code& ec, const auto& /*sock*/) mutable
                         { next(ec, std::move(socket)); });
   }

   template <typename Stream, typename F>
   void do_connect(std::shared_ptr<HttpClientSocket<Stream>>&& socket,
                   StringEndpoint&&                            endpoint,
                   F&&                                         next)
   {
      auto [host, port] = split_port(endpoint.host);
      if (port.empty())
         port = "80";
      else
         port.remove_prefix(1);
      auto& resolver = *endpoint.resolver;
      resolver.async_resolve(
          host, port,
          [socket = std::move(socket), next = std::forward<F>(next),
           _ = std::move(endpoint.resolver)](const std::error_code& ec, auto&& endpoints) mutable
          {
             if (ec)
             {
                next(ec, std::move(socket));
             }
             else
             {
                do_connect_resolved(std::move(socket), std::move(endpoints), std::move(next));
             }
          });
   }

   // endpoint should be either tcp::endpoint or StringEndpoint
   template <typename E, typename F>
   void dispatch_tls(boost::asio::io_context& context,
                     server_state&            state,
                     E&&                      endpoint,
                     std::string_view         hostport,
                     std::optional<TLSInfo>&& tls,
                     const auto&              add,
                     F&&                      next)
   {
      if (tls)
      {
         using tls_stream = boost::beast::ssl_stream<boost::beast::tcp_stream>;
         auto result      = std::make_shared<HttpClientSocket<tls_stream>>(
             context, state, *state.http_config->tls_context);
         add(result);
         auto [host, _] = split_port(hostport);
         result->stream.set_verify_mode(boost::asio::ssl::verify_peer);
         result->stream.set_verify_callback(
             boost::asio::ssl::host_name_verification(std::string(host)));
         auto ssl_conn = result->stream.native_handle();
         SSL_set_tlsext_host_name(ssl_conn, std::string(host).c_str());
         do_connect(std::move(result), std::forward<E>(endpoint),
                    [next = std::forward<F>(next)](const std::error_code& ec, auto&& socket) mutable
                    {
                       if (ec)
                       {
                          next(ec, std::move(socket));
                       }
                       else
                       {
                          auto& ssl = socket->stream;
                          ssl.async_handshake(boost::asio::ssl::stream_base::client,
                                              [socket = std::move(socket), next = std::move(next)](
                                                  const std::error_code& ec) mutable
                                              { next(ec, std::move(socket)); });
                       }
                    });
      }
      else
      {
         auto result = std::make_shared<HttpClientSocket<boost::beast::tcp_stream>>(context, state);
         add(result);
         do_connect(std::move(result), std::forward<E>(endpoint), std::forward<F>(next));
      }
   }

   template <typename F>
   void dispatch_endpoint(boost::asio::io_context& context,
                          server_state&            state,
                          const IPV4Endpoint&      endpoint,
                          std::string_view         host,
                          std::optional<TLSInfo>&& tls,
                          const auto&              add,
                          F&&                      next)
   {
      return dispatch_tls(context, state,
                          boost::asio::ip::tcp::endpoint(
                              boost::asio::ip::address_v4{endpoint.address.bytes}, endpoint.port),
                          host, std::move(tls), add, std::forward<F>(next));
   }

   template <typename F>
   void dispatch_endpoint(boost::asio::io_context& context,
                          server_state&            state,
                          const IPV6Endpoint&      endpoint,
                          std::string_view         host,
                          std::optional<TLSInfo>&& tls,
                          const auto&              add,
                          F&&                      next)
   {
      dispatch_tls(context, state,
                   boost::asio::ip::tcp::endpoint(
                       boost::asio::ip::address_v6{endpoint.address.bytes, endpoint.address.zone},
                       endpoint.port),
                   host, std::move(tls), add, std::forward<F>(next));
   }

   template <typename F>
   void dispatch_endpoint(boost::asio::io_context& context,
                          server_state&            state,
                          const LocalEndpoint&     endpoint,
                          std::string_view         host,
                          std::optional<TLSInfo>&& tls,
                          const auto&              add,
                          F&&                      next)
   {
      if (tls)
         abortMessage("Local socket does not support TLS");
      auto result = std::make_shared<HttpClientSocket<local_stream>>(context, state);
      add(result);
      do_connect(std::move(result), boost::asio::local::stream_protocol::endpoint(endpoint.path),
                 std::forward<F>(next));
   }
}  // namespace

void psibase::http::send_request(boost::asio::io_context&        context,
                                 server_state&                   state,
                                 HttpRequest&&                   req,
                                 std::optional<TLSInfo>&&        tls,
                                 std::optional<SocketEndpoint>&& endpoint,
                                 const std::function<void(const std::shared_ptr<Socket>&)>& add)
{
   auto host = req.host;
   auto next = [req = std::move(req), &state](const std::error_code& ec, auto&& socket) mutable
   {
      if (ec)
      {
         PSIBASE_LOG(socket->logger, warning) << "Connection failed: " << ec.message();
         socket->do_error(ec);
      }
      else
      {
         socket->savedInfo.endpoint =
             toSocketEndpoint(get_lowest_layer(socket->stream).socket().remote_endpoint());
         socket->savedInfo.tls = isSecure(socket->stream) ? std::optional<TLSInfo>() : std::nullopt;
         socket->do_write(std::shared_ptr{socket}, std::move(req));
         socket->do_read(std::move(socket));
      }
   };
   if (!endpoint)
   {
      return dispatch_tls(context, state,
                          StringEndpoint{std::move(host),
                                         std::make_shared<boost::asio::ip::tcp::resolver>(context)},
                          host, std::move(tls), add, std::move(next));
   }
   else
   {
      return std::visit(
          [&](const auto& endpoint)
          {
             return dispatch_endpoint(context, state, endpoint, host, std::move(tls), add,
                                      std::move(next));
          },
          *endpoint);
   }
}
