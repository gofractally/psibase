// Adapted from Boost Beast Advanced Server example
//
// Copyright (c) 2016-2019 Vinnie Falco (vinnie dot falco at gmail dot com)
//
// Distributed under the Boost Software License, Version 1.0. (See accompanying
// file LICENSE_1_0.txt or copy at http://www.boost.org/LICENSE_1_0.txt)

#include "psibase/http.hpp"
#include "psibase/log.hpp"

#include "http_session.hpp"
#include "send_request.hpp"
#include "server_state.hpp"
#include "tcp_http_session.hpp"
#include "tls_http_session.hpp"
#include "unix_http_session.hpp"

#include <boost/asio/bind_executor.hpp>
#include <boost/asio/io_context.hpp>
#include <boost/asio/local/stream_protocol.hpp>
#include <boost/asio/signal_set.hpp>
#include <boost/asio/strand.hpp>
#include <boost/beast/core.hpp>
#include <boost/beast/http.hpp>
#include <boost/beast/version.hpp>
#include <boost/beast/websocket.hpp>

#include <algorithm>
#include <charconv>
#include <cstdlib>
#include <functional>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include <pthread.h>

namespace beast = boost::beast;                     // from <boost/beast.hpp>
namespace bhttp = beast::http;                      // from <boost/beast/http.hpp>
namespace net   = boost::asio;                      // from <boost/asio.hpp>
using tcp       = boost::asio::ip::tcp;             // from <boost/asio/ip/tcp.hpp>
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
      net::io_context          ioc;
      std::vector<std::thread> threads = {};
      shutdown_tracker         thread_count;

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
       : service(ctx), impl(std::make_shared<server_impl>(http_config, sharedState))
   {
   }

   void server_service::start()
   {
      check(impl->http_config->num_threads > 0, "too few threads");
      impl->start();
   }

   HttpConnector server_service::get_connector()
   {
      return HttpConnector{impl.get()};
   }

   HttpConnector::HttpConnector(server_impl* state) : state(state) {}

   void HttpConnector::operator()(std::span<const char> args, const AddSocketFn& add)
   {
      using Args = std::tuple<HttpRequest, std::optional<TLSInfo>, std::optional<SocketEndpoint>>;
      auto [request, tls, endpoint] = psio::from_frac<Args>(args);
      if (!endpoint)
      {
         std::string_view target = request.target;
         if (target.starts_with('/') || target == "*")
         {
            // origin-form and asterisk-form do not include a host
            // in the target
         }
         else if (request.method == "CONNECT")
         {
            // authority-form
         }
         else
         {
            // absolute-form
            auto [scheme, host, path] = splitURL(target);
            if (scheme == "https")
            {
               if (!tls)
                  tls.emplace();
            }
            else
            {
               check(!tls, "Cannot specify TLS options for HTTP connection");
            }
            request.target = path;
            request.host   = host;
         }
      }
      send_request(static_cast<server_impl*>(state)->ioc, *state, std::move(request),
                   std::move(tls), std::move(endpoint), add);
   }

}  // namespace psibase::http
