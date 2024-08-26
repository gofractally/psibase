// Adapted from Boost Beast Advanced Server example
//
// Copyright (c) 2016-2019 Vinnie Falco (vinnie dot falco at gmail dot com)
//
// Distributed under the Boost Software License, Version 1.0. (See accompanying
// file LICENSE_1_0.txt or copy at http://www.boost.org/LICENSE_1_0.txt)

#include "psibase/http.hpp"
#include "psibase/log.hpp"

#include "http_session_base.hpp"
#include "server_state.hpp"

#include <boost/asio/bind_executor.hpp>
#include <boost/asio/io_service.hpp>
#include <boost/asio/local/stream_protocol.hpp>
#include <boost/asio/signal_set.hpp>
#include <boost/asio/strand.hpp>
#include <boost/beast/core.hpp>
#include <boost/beast/http.hpp>
#ifdef PSIBASE_ENABLE_SSL
#include <boost/beast/ssl.hpp>
#endif
#include <boost/beast/version.hpp>
#include <boost/beast/websocket.hpp>
#include <boost/make_unique.hpp>
#include <boost/optional.hpp>
#include <boost/signals2/signal.hpp>

#include <algorithm>
#include <charconv>
#include <cstdlib>
#include <functional>
#include <iostream>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include <pthread.h>

namespace beast     = boost::beast;  // from <boost/beast.hpp>
namespace websocket = beast::websocket;
namespace bhttp     = beast::http;                  // from <boost/beast/http.hpp>
namespace net       = boost::asio;                  // from <boost/asio.hpp>
using tcp           = boost::asio::ip::tcp;         // from <boost/asio/ip/tcp.hpp>
using unixs = boost::asio::local::stream_protocol;  // from <boost/asio/local/stream_protocol.hpp>

using namespace std::literals;
using std::chrono::steady_clock;  // To create explicit timer

namespace psibase::http
{
   // Report a failure
   static void fail(psibase::loggers::common_logger& logger, beast::error_code ec, const char* what)
   {
      PSIBASE_LOG(logger, warning) << what << ": " << ec.message();
   }

   struct shutdown_tracker
   {
      void lock()
      {
         std::lock_guard l{mutex};
         ++count;
      }
      void unlock()
      {
         std::lock_guard l{mutex};
         if (--count == 0 && callback)
         {
            callback();
         }
      }
      void async_wait(std::function<void()> f)
      {
         std::unique_lock l{mutex};
         if (count)
         {
            callback = std::move(f);
         }
         else
         {
            f();
         }
      }
      std::mutex            mutex;
      int                   count = 0;
      std::function<void()> callback;
   };

   struct server_impl : server_state
   {
      net::io_service          ioc;
      std::vector<std::thread> threads = {};
      using signal_type                = boost::signals2::signal<void(bool)>;
      shutdown_tracker thread_count;

      server_impl(const std::shared_ptr<const http::http_config>& http_config,
                  const std::shared_ptr<psibase::SharedState>&    sharedState)
          : server_state{http_config, sharedState}
      {
      }

      ~server_impl() { stop(); }

      bool start();

      void stop()
      {
         ioc.stop();
         for (auto& t : threads)
            t.join();
         threads.clear();
         http_config.reset();
         sharedState.reset();
      }

   };  // server_impl

   void server_service::async_close(bool restart, std::function<void()> callback)
   {
      impl->thread_count.async_wait(std::move(callback));
      impl->shutdown_connections(restart);
   }

   void server_service::shutdown() noexcept
   {
      if (impl)
      {
         impl->stop();
      }
   }

   // Handles an HTTP server connection
   template <typename SessionType>
   class http_session : public http_session_base
   {
     public:
      std::shared_ptr<SessionType> shared_from_this()
      {
         return std::static_pointer_cast<SessionType>(http_session_base::shared_from_this());
      }

      virtual void post(std::function<void()> f) override
      {
         net::post(derived_session().stream.get_executor(), std::move(f));
      }

      void write_response(message_type&& msg) override
      {
         bhttp::async_write(
             derived_session().stream, msg,
             beast::bind_front_handler(&http_session::on_write,
                                       derived_session().shared_from_this(), msg.need_eof()));
      }
      void accept_websocket(request_type&& request, accept_p2p_websocket_t&& next) override
      {
         using ws_type = websocket::stream<decltype(derived_session().stream)>;
         struct op
         {
            request_type           request;
            ws_type                stream;
            accept_p2p_websocket_t next;
         };

         auto ptr = std::make_shared<op>(
             op{std::move(request),
                websocket::stream<decltype(move_stream())>{std::move(move_stream())},
                std::move(next)});

         auto p = ptr.get();
         // Capture only the stream, not self, because after returning, there is
         // no longer anything keeping the session alive
         p->stream.async_accept(p->request, std::function<void(const std::error_code&)>(
                                                [ptr = std::move(ptr)](const std::error_code& ec)
                                                {
                                                   if (!ec)
                                                   {
                                                      ptr->next(std::move(ptr->stream));
                                                   }
                                                }));
      }

      http_session(server_impl& server) : http_session_base(server)
      {
         logger.add_attribute("Channel", boost::log::attributes::constant(std::string("http")));
      }

      ~http_session() { PSIBASE_LOG(logger, debug) << "Connection closed"; }

      // Start the session
      void run()
      {
         PSIBASE_LOG(logger, debug) << "Accepted connection";
         _timer.reset(new boost::asio::steady_timer(derived_session().stream.get_executor()));
         start_socket_timer();
         do_read();
      }

      SessionType& derived_session() { return static_cast<SessionType&>(*this); }

      auto move_stream()
      {
         auto result = std::move(derived_session().stream);
         _closed     = true;
         _timer->cancel();
         return result;
      }

     public:
      void do_read() override
      {
         // Construct a new parser for each message
         parser.emplace();

         // Apply a reasonable limit to the allowed size
         // of the body in bytes to prevent abuse.
         parser->body_limit(server.http_config->max_request_size);
         // Read a request using the parser-oriented interface
         bhttp::async_read(derived_session().stream, buffer, *parser,
                           beast::bind_front_handler(&http_session::on_read,
                                                     derived_session().shared_from_this()));
      }

     private:
     public:
     protected:
      void common_shutdown_impl()
      {
         beast::error_code ec;
         derived_session().stream.socket().shutdown(tcp::socket::shutdown_both, ec);
         if (ec)
         {
            PSIBASE_LOG(logger, warning) << "shutdown: " << ec.message();
         }
         derived_session().stream.socket().close(ec);
         if (ec)
         {
            PSIBASE_LOG(logger, warning) << "close: " << ec.message();
         }
      }
   };  // http_session

   struct tcp_http_session : public http_session<tcp_http_session>
   {
      tcp_http_session(server_impl& server, tcp::socket&& socket)
          : http_session<tcp_http_session>(server), stream(std::move(socket))
      {
         std::ostringstream ss;
         ss << stream.socket().remote_endpoint();
         logger.add_attribute("RemoteEndpoint",
                              boost::log::attributes::constant<std::string>(ss.str()));
      }

      bool check_access(const authz_loopback&) const
      {
         return stream.socket().remote_endpoint().address().is_loopback();
      }

      bool check_access(const authz_ip& addr) const
      {
         return stream.socket().remote_endpoint().address() == addr.address;
      }

      void close_impl(beast::error_code& ec) { stream.socket().close(ec); }
      void shutdown_impl() { common_shutdown_impl(); }

      beast::tcp_stream stream;
   };

#ifdef PSIBASE_ENABLE_SSL
   struct tls_http_session : public http_session<tls_http_session>
   {
      tls_http_session(server_impl& server, tcp::socket&& socket)
          : http_session<tls_http_session>(server),
            context(server.http_config->tls_context),
            stream(std::move(socket), *context)
      {
         std::ostringstream ss;
         ss << stream.next_layer().socket().remote_endpoint();
         logger.add_attribute("RemoteEndpoint",
                              boost::log::attributes::constant<std::string>(ss.str()));
      }

      bool check_access(const authz_loopback& addr) const
      {
         return stream.next_layer().socket().remote_endpoint().address().is_loopback();
      }

      bool check_access(const authz_ip& addr) const
      {
         return stream.next_layer().socket().remote_endpoint().address() == addr.address;
      }

      void shutdown_impl()
      {
         stream.async_shutdown([self = shared_from_this()](const std::error_code& ec) {});
      }

      void close_impl(beast::error_code& ec) { stream.next_layer().socket().close(ec); }

      void run()
      {
         stream.async_handshake(boost::asio::ssl::stream_base::server,
                                [self = shared_from_this()](const std::error_code& ec)
                                {
                                   if (!ec)
                                   {
                                      self->http_session<tls_http_session>::run();
                                   }
                                });
      }

      tls_context_ptr                             context;
      boost::beast::ssl_stream<beast::tcp_stream> stream;
   };
#endif

   struct unix_http_session : public http_session<unix_http_session>
   {
      unix_http_session(server_impl& server, unixs::socket&& socket)
          : http_session<unix_http_session>(server), stream(std::move(socket))
      {
         logger.add_attribute("RemoteEndpoint", boost::log::attributes::constant<std::string>(
                                                    stream.socket().remote_endpoint().path()));
      }

      bool check_access(const authz_loopback& addr) const { return true; }
      bool check_access(const authz_ip& addr) const { return false; }

      void close_impl(beast::error_code& ec) { stream.socket().close(ec); }
      void shutdown_impl() { common_shutdown_impl(); }

      beast::basic_stream<unixs,
#if BOOST_VERSION >= 107400
                          boost::asio::any_io_executor,
#else
                          boost::asio::executor,
#endif
                          beast::unlimited_rate_policy>
          stream;
   };

   // Accepts incoming connections and launches the sessions
   template <typename Acceptor>
   class listener : public std::enable_shared_from_this<listener<Acceptor>>
   {
      server_impl&                    server;
      Acceptor                        acceptor;
      psibase::loggers::common_logger logger;

     public:
      listener(server_impl& server, const typename Acceptor::endpoint_type& endpoint)
          : server(server), acceptor(net::make_strand(server.ioc))
      {
         logger.add_attribute("Channel", boost::log::attributes::constant(std::string("http")));
         start_listen(endpoint);
      }

      static void close(std::shared_ptr<listener>&& self, bool)
      {
         boost::asio::dispatch(self->acceptor.get_executor(),
                               [self]
                               {
                                  if (self->acceptor.is_open())
                                  {
                                     self->acceptor.cancel();
                                  }
                               });
      }

      void listen_fail() { throw std::runtime_error("unable to open listen socket"); }

      template <typename Endpoint>
      void start_listen(const Endpoint& endpoint)
      {
         beast::error_code ec;

         auto check_ec = [&](const char* what)
         {
            if (!ec)
               return;
            PSIBASE_LOG(logger, error) << what << ": " << ec.message();
            listen_fail();
         };

         // Open the acceptor
         acceptor.open(endpoint.protocol(), ec);
         check_ec("open");

         // Bind to the server address
         acceptor.set_option(net::socket_base::reuse_address(true));
         acceptor.bind(endpoint, ec);
         check_ec("bind");

         // Start listening for connections
         acceptor.listen(net::socket_base::max_listen_connections, ec);
         check_ec("listen");
      }

      // Start accepting incoming connections
      template <typename Session>
      bool run()
      {
         server.register_connection(this->shared_from_this());
         do_accept<Session>();
         PSIBASE_LOG(logger, info) << "Listening on " << acceptor.local_endpoint();
         return true;
      }

     private:
      template <typename Session>
      void do_accept()
      {
         // The new connection gets its own strand
         acceptor.async_accept(
             net::make_strand(server.ioc),
             beast::bind_front_handler(
                 [self = this->shared_from_this(), this](beast::error_code ec, auto socket) mutable
                 {
                    if (ec)
                    {
                       if (ec != boost::asio::error::operation_aborted)
                       {
                          fail(logger, ec, "accept");
                       }
                    }
                    else
                    {
                       // Create the http session and run it
                       std::make_shared<Session>(self->server, std::move(socket))->run();
                    }

                    // Accept another connection
                    if (ec != boost::asio::error::operation_aborted)
                    {
                       do_accept<Session>();
                    }
                    else
                    {
                       PSIBASE_LOG(logger, info)
                           << "Stopping "
                           << (std::is_same_v<Acceptor, tcp::acceptor> ? "TCP" : "unix")
                           << " listener";
                    }
                 }));
      }
   };  // listener

   listen_spec parse_listen(const std::string& s)
   {
      auto parse_host = [](std::string_view s, bool secure) -> listen_spec
      {
         if (s.ends_with('/'))
         {
            s = s.substr(0, s.size() - 1);
         }
         if (secure)
         {
            return parse_listen_tcp<true>(std::string(s));
         }
         else
         {
            return parse_listen_tcp<false>(std::string(s));
         }
      };
      if (s.starts_with("http://"))
      {
         return parse_host(s.substr(7), false);
      }
      else if (s.starts_with("https://"))
      {
#ifdef PSIBASE_ENABLE_SSL
         return parse_host(s.substr(8), true);
#else
         throw std::runtime_error("Cannot listen on " + s +
                                  " because psinode was compiled without TLS support");
#endif
      }
      else if (s.find('/') != std::string_view::npos)
      {
         return local_listen_spec(s);
      }
      else
      {
         return parse_listen_tcp<false>(s);
      }
   }

   template <bool Secure>
   tcp_listen_spec<Secure> parse_listen_tcp(const std::string& s)
   {
      auto check = [&](bool b)
      {
         if (!b)
            throw std::runtime_error("Invalid endpoint: " + s);
      };
      net::ip::address addr;
      unsigned short   port = Secure ? 443 : 80;
      if (s.starts_with('['))
      {
         auto end = s.find(']');
         check(end != std::string::npos);
         addr = net::ip::make_address_v6(s.substr(1, end - 1));
         if (end + 1 != s.size())
         {
            check(s[end + 1] == ':');
            auto res = std::from_chars(s.data() + end + 2, s.data() + s.size(), port);
            check(res.ec == std::errc{} && res.ptr == s.data() + s.size());
         }
      }
      else
      {
         boost::system::error_code ec;
         addr = net::ip::make_address(s, ec);
         if (ec)
         {
            auto pos = s.rfind(':');
            if (pos == std::string::npos)
            {
               addr = net::ip::make_address("0.0.0.0");
               pos  = 0;
            }
            else
            {
               addr = net::ip::make_address_v4(s.substr(0, pos));
               pos  = pos + 1;
            }
            auto res = std::from_chars(s.data() + pos, s.data() + s.size(), port);
            check(res.ec == std::errc{} && res.ptr == s.data() + s.size());
         }
      }
      return {{addr, port}};
   }
   local_listen_spec parse_listen_local(const std::string& s)
   {
      return local_listen_spec(s);
   }

   template <bool Secure>
   std::string to_string(const tcp_listen_spec<Secure>& spec)
   {
      std::ostringstream ss;
      ss << spec.endpoint;
      if constexpr (Secure)
      {
         return "https://" + ss.str();
      }
      else
      {
         return ss.str();
      }
   }

   std::string to_string(const local_listen_spec& spec)
   {
      auto result = spec.path();
      if (result.find('/') == std::string::npos)
      {
         result = "./" + result;
      }
      return result;
   }

   std::string to_string(const listen_spec& spec)
   {
      return std::visit([](const auto& spec) { return to_string(spec); }, spec);
   }

   template <bool Secure>
   bool make_listener(server_impl& server, const tcp_listen_spec<Secure>& spec)
   {
      auto l = std::make_shared<listener<net::ip::tcp::acceptor>>(server, spec.endpoint);
      if constexpr (Secure)
      {
#if PSIBASE_ENABLE_SSL
         return l->template run<tls_http_session>();
#else
         return false;
#endif
      }
      else
      {
         return l->template run<tcp_http_session>();
      }
   }

   bool make_listener(server_impl& server, const local_listen_spec& spec)
   {
      //take a sniff and see if anything is already listening at the given socket path, or if the socket path exists
      // but nothing is listening
      boost::system::error_code test_ec;
      unixs::socket             test_socket(server.ioc);
      test_socket.connect(spec, test_ec);

      //looks like a service is already running on that socket, don't touch it... fail out
      if (test_ec == boost::system::errc::success)
      {
         PSIBASE_LOG(loggers::generic::get(), error) << "http unix socket is in use";
         return false;
      }
      //socket exists but no one home, go ahead and remove it and continue on
      else if (test_ec == boost::system::errc::connection_refused)
         ::unlink(spec.path().c_str());
      else if (test_ec != boost::system::errc::no_such_file_or_directory)
      {
         PSIBASE_LOG(loggers::generic::get(), error)
             << "unexpected failure when probing existing http unix socket: " << test_ec.message();
         return false;
      }
      return std::make_shared<listener<unixs::acceptor>>(server, spec)->run<unix_http_session>();
   }

   bool server_impl::start()
   {
      bool has_listener = false;
      for (const auto& spec : http_config->listen)
      {
         has_listener |=
             std::visit([&](const auto& spec) { return make_listener(*this, spec); }, spec);
      }
      if (!has_listener)
      {
         return false;
      }

      threads.reserve(http_config->num_threads);
      for (unsigned i = 0; i < http_config->num_threads; ++i)
      {
         threads.emplace_back(
             [this, i, _ = std::unique_lock{thread_count}]() mutable
             {
#ifdef __APPLE__
                pthread_setname_np(("http-" + std::to_string(i)).c_str());
#else
                pthread_setname_np(pthread_self(), ("http-" + std::to_string(i)).c_str());
#endif
                ioc.run();
             });
      }
      return true;
   }

   server_service::server_service(boost::asio::execution_context& ctx) : service(ctx) {}
   server_service::server_service(net::execution_context&                   ctx,
                                  const std::shared_ptr<const http_config>& http_config,
                                  const std::shared_ptr<SharedState>&       sharedState)
       : service(ctx)
   {
      check(http_config->num_threads > 0, "too few threads");
      auto server = std::make_shared<server_impl>(http_config, sharedState);
      if (server->start())
         impl = std::move(server);
   }

}  // namespace psibase::http
