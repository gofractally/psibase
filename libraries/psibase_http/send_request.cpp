#include "send_request.hpp"

#include <boost/asio/io_context.hpp>
#include <boost/asio/ip/tcp.hpp>
#include <boost/asio/local/stream_protocol.hpp>
#include <boost/asio/ssl/host_name_verification.hpp>
#include <boost/asio/strand.hpp>
#include <boost/beast/core.hpp>
#include <boost/beast/http.hpp>
#include <boost/beast/ssl.hpp>
#include <psibase/BlockContext.hpp>
#include <psibase/Rpc.hpp>
#include <psibase/Socket.hpp>
#include <psibase/SocketInfo.hpp>
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
   std::pair<beast::string_view, beast::string_view> split_port(beast::string_view host);
}

namespace
{
   template <typename Stream>
   struct HttpClientSocket : AutoCloseSocket
   {
      template <typename... A>
      explicit HttpClientSocket(boost::asio::io_context& context, A&&... a)
          : stream(boost::asio::make_strand(context), std::forward<A>(a)...)
      {
      }
      void do_write(std::shared_ptr<HttpClientSocket>&& self, HttpRequest&& req)
      {
         auto  requestPtr = std::make_shared<bhttp::request<bhttp::vector_body<char>>>();
         auto& request    = *requestPtr;
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
      void do_read(std::shared_ptr<HttpClientSocket>&& self, server_state& server)
      {
         // Apply a reasonable limit to the allowed size
         // of the body in bytes to prevent abuse.
         parser.body_limit(server.http_config->max_request_size);
         // Read a request using the parser-oriented interface
         boost::beast::http::async_read(
             stream, buffer, parser,
             [self = std::move(self), &server](const std::error_code& ec,
                                               std::size_t            bytes_transferred)
             {
                if (ec)
                {
                   PSIBASE_LOG(self->logger, warning)
                       << "Failed to read HTTP response: " << ec.message();
                   self->do_error(server, ec);
                }
                else
                {
                   auto system = server.sharedState->getSystemContext();

                   psio::finally f{[&]()
                                   { server.sharedState->addSystemContext(std::move(system)); }};
                   BlockContext  bc{*system, system->sharedDatabase.getHead(),
                                   system->sharedDatabase.createWriter(), true};
                   bc.start();

                   SignedTransaction trx;
                   TransactionTrace  trace;

                   auto breply = self->parser.get();

                   HttpReply reply{
                       .status      = static_cast<HttpStatus>(breply.result_int()),
                       .contentType = breply[bhttp::field::content_type],
                       .body        = breply.body(),
                   };

                   for (auto&& header : breply)
                   {
                      reply.headers.push_back(HttpHeader{std::string(header.name_string()),
                                                         std::string(header.value())});
                   }

                   Action action{
                       .sender  = AccountNumber(),
                       .service = proxyServiceNum,
                       .rawData = psio::convert_to_frac(std::tuple(self->id, psio::to_frac(reply))),
                   };

                   try
                   {
                      auto& atrace = bc.execAsyncExport("recv", std::move(action), trace);
                      BOOST_LOG_SCOPED_LOGGER_TAG(bc.trxLogger, "Trace", std::move(trace));
                      PSIBASE_LOG(bc.trxLogger, debug)
                          << action.service.str() << "::recv succeeded";
                   }
                   catch (std::exception& e)
                   {
                      BOOST_LOG_SCOPED_LOGGER_TAG(bc.trxLogger, "Trace", std::move(trace));
                      PSIBASE_LOG(bc.trxLogger, warning)
                          << action.service.str() << "::recv failed: " << e.what();
                   }
                }
             });
      }
      void do_error(server_state& server, const std::error_code& ec)
      {
         auto system = server.sharedState->getSystemContext();

         psio::finally f{[&]() { server.sharedState->addSystemContext(std::move(system)); }};
         BlockContext  bc{*system, system->sharedDatabase.getHead(),
                         system->sharedDatabase.createWriter(), true};
         bc.start();

         TransactionTrace trace;

         Action action{
             .sender  = AccountNumber(),
             .service = proxyServiceNum,
             .rawData = psio::convert_to_frac(std::tuple(this->id)),
         };
         try
         {
            bc.execAsyncExport("close", std::move(action), trace);
            BOOST_LOG_SCOPED_LOGGER_TAG(bc.trxLogger, "Trace", std::move(trace));
            PSIBASE_LOG(bc.trxLogger, debug) << action.service.str() << "::close succeeded";
         }
         catch (std::exception& e)
         {
            BOOST_LOG_SCOPED_LOGGER_TAG(bc.trxLogger, "Trace", std::move(trace));
            PSIBASE_LOG(bc.trxLogger, warning)
                << action.service.str() << "::close failed: " << e.what();
         }
      }
      virtual void send(std::span<const char>) override
      {
         abortMessage("Cannot send additional requests through a client socket");
      }
      virtual SocketInfo info() const override { return HttpClientSocketInfo{}; }
      virtual void       autoClose(const std::optional<std::string>& message) noexcept override {}
      Stream             stream;
      boost::beast::http::response_parser<boost::beast::http::vector_body<char>> parser;
      boost::beast::flat_buffer                                                  buffer;
      psibase::loggers::common_logger                                            logger;
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
             context, *state.http_config->tls_context);
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
         auto result = std::make_shared<HttpClientSocket<boost::beast::tcp_stream>>(context);
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
      auto result = std::make_shared<HttpClientSocket<local_stream>>(context);
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
         socket->do_error(state, ec);
      }
      else
      {
         socket->do_write(std::shared_ptr{socket}, std::move(req));
         socket->do_read(std::move(socket), state);
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
