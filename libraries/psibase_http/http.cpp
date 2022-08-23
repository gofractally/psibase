// Adapted from Boost Beast Advanced Server example
//
// Copyright (c) 2016-2019 Vinnie Falco (vinnie dot falco at gmail dot com)
//
// Distributed under the Boost Software License, Version 1.0. (See accompanying
// file LICENSE_1_0.txt or copy at http://www.boost.org/LICENSE_1_0.txt)

#include "psibase/http.hpp"
#include "psibase/TransactionContext.hpp"
#include "psibase/contractEntry.hpp"

#include <boost/asio/bind_executor.hpp>
#include <boost/asio/io_service.hpp>
#include <boost/asio/local/stream_protocol.hpp>
#include <boost/asio/signal_set.hpp>
#include <boost/asio/strand.hpp>
#include <boost/beast/core.hpp>
#include <boost/beast/http.hpp>
#include <boost/beast/version.hpp>
#include <boost/beast/websocket.hpp>
#include <boost/make_unique.hpp>
#include <boost/optional.hpp>

#include <psio/finally.hpp>
#include <psio/to_json.hpp>

#include <algorithm>
#include <cstdlib>
#include <functional>
#include <iostream>
#include <memory>
#include <string>
#include <thread>
#include <vector>

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
   struct websocket_upgrade
   {
   };

   // Report a failure
   static void fail(beast::error_code ec, const char* what)
   {
      // TODO: elog("${w}: ${s}", ("w", what)("s", ec.message()));
   }

   struct server_impl : server, std::enable_shared_from_this<server_impl>
   {
      net::io_service                          ioc;
      std::shared_ptr<const http::http_config> http_config = {};
      std::shared_ptr<psibase::SharedState>    sharedState = {};
      std::vector<std::thread>                 threads     = {};

      server_impl(const std::shared_ptr<const http::http_config>& http_config,
                  const std::shared_ptr<psibase::SharedState>&    sharedState)
          : http_config{http_config}, sharedState{sharedState}
      {
      }

      virtual ~server_impl()
      {
         // TODO: BUG: refcount fell to 0, but threads haven't stopped
         //            yet. A thread may try to bump it back up.
         stop();
      }

      bool start();

      virtual void stop() override
      {
         ioc.stop();
         for (auto& t : threads)
            t.join();
         threads.clear();
      }
   };  // server_impl

   // This function produces an HTTP response for the given
   // request. The type of the response object depends on the
   // contents of the request, so the interface requires the
   // caller to pass a generic lambda for receiving the response.
   template <class Body, class Allocator, class Send>
   void handle_request(server_impl&                                           server,
                       bhttp::request<Body, bhttp::basic_fields<Allocator>>&& req,
                       Send&&                                                 send)
   {
      unsigned req_version    = req.version();
      bool     req_keep_alive = req.keep_alive();

      const auto set_cors = [&server](auto& res)
      {
         if (!server.http_config->allow_origin.empty())
         {
            res.set(bhttp::field::access_control_allow_origin, server.http_config->allow_origin);
            res.set(bhttp::field::access_control_allow_methods, "POST, GET, OPTIONS");
            res.set(bhttp::field::access_control_allow_headers, "*");
         }
      };

      // Returns a bad request response
      const auto bad_request =
          [&server, set_cors, req_version, req_keep_alive](beast::string_view why)
      {
         bhttp::response<bhttp::string_body> res{bhttp::status::bad_request, req_version};
         res.set(bhttp::field::server, BOOST_BEAST_VERSION_STRING);
         res.set(bhttp::field::content_type, "text/html");
         set_cors(res);
         res.keep_alive(req_keep_alive);
         res.body() = why.to_string();
         res.prepare_payload();
         return res;
      };

      // Returns a not found response
      const auto not_found =
          [&server, set_cors, req_version, req_keep_alive](beast::string_view target)
      {
         bhttp::response<bhttp::string_body> res{bhttp::status::not_found, req_version};
         res.set(bhttp::field::server, BOOST_BEAST_VERSION_STRING);
         res.set(bhttp::field::content_type, "text/html");
         set_cors(res);
         res.keep_alive(req_keep_alive);
         res.body() = "The resource '" + target.to_string() + "' was not found.";
         res.prepare_payload();
         return res;
      };

      // Returns an error response
      const auto error =
          [&server, set_cors, req_version, req_keep_alive](
              bhttp::status status, beast::string_view why, const char* content_type = "text/html")
      {
         bhttp::response<bhttp::string_body> res{status, req_version};
         res.set(bhttp::field::server, BOOST_BEAST_VERSION_STRING);
         res.set(bhttp::field::content_type, content_type);
         set_cors(res);
         res.keep_alive(req_keep_alive);
         res.body() = why.to_string();
         res.prepare_payload();
         return res;
      };

      const auto ok = [&server, set_cors, req_version, req_keep_alive](
                          std::vector<char> reply, const char* content_type,
                          const std::vector<HttpHeader>* headers = nullptr)
      {
         bhttp::response<bhttp::vector_body<char>> res{bhttp::status::ok, req_version};
         res.set(bhttp::field::server, BOOST_BEAST_VERSION_STRING);
         if (headers)
            for (auto& h : *headers)
               res.set(h.name, h.value);
         res.set(bhttp::field::content_type, content_type);
         set_cors(res);
         res.keep_alive(req_keep_alive);
         res.body() = std::move(reply);
         res.prepare_payload();
         return res;
      };

      const auto ok_no_content = [&server, set_cors, req_version, req_keep_alive]()
      {
         bhttp::response<bhttp::vector_body<char>> res{bhttp::status::ok, req_version};
         res.set(bhttp::field::server, BOOST_BEAST_VERSION_STRING);
         set_cors(res);
         res.keep_alive(req_keep_alive);
         res.prepare_payload();
         return res;
      };

      try
      {
         auto host  = req.at("Host");
         auto colon = host.find(':');
         if (colon != host.npos)
            host.remove_suffix(host.size() - colon);

         if (req.method() == bhttp::verb::options)
         {
            return send(ok_no_content());
         }

         else if (!req.target().starts_with("/native"))
         {
            auto        startTime = steady_clock::now();
            HttpRequest data;
            if (req.method() == bhttp::verb::get)
               data.method = "GET";
            else if (req.method() == bhttp::verb::post)
               data.method = "POST";
            else
               return send(error(bhttp::status::bad_request,
                                 "Unsupported HTTP-method for " + req.target().to_string() + "\n"));
            data.host        = {host.begin(), host.size()};
            data.rootHost    = server.http_config->host;
            data.target      = req.target().to_string();
            data.contentType = (std::string)req[bhttp::field::content_type];
            data.body        = std::move(req.body());

            // TODO: time limit
            auto          system = server.sharedState->getSystemContext();
            psio::finally f{[&]() { server.sharedState->addSystemContext(std::move(system)); }};
            BlockContext  bc{*system, system->sharedDatabase.getHead()};
            bc.start();
            if (bc.needGenesisAction)
               return send(error(bhttp::status::internal_server_error,
                                 "Need genesis block; use 'psibase boot' to boot chain"));
            SignedTransaction trx;
            Action            action{
                           .sender   = AccountNumber(),
                           .contract = proxyContractNum,
                           .rawData  = psio::convert_to_frac(data),
            };
            TransactionTrace   trace;
            TransactionContext tc{bc, trx, trace, true, false, true};
            ActionTrace        atrace;
            auto               startExecTime = steady_clock::now();
            tc.execServe(action, atrace);
            auto endExecTime = steady_clock::now();
            // TODO: option to print this
            // printf("%s\n", prettyTrace(atrace).c_str());
            auto result  = psio::convert_from_frac<std::optional<HttpReply>>(atrace.rawRetval);
            auto endTime = steady_clock::now();
            if (server.http_config->host_perf)
            {
               auto t = [](const auto& duration) {
                  return std::to_string(
                      std::chrono::duration_cast<std::chrono::microseconds>(duration).count());
               };
               std::string report;
               report += "handling " + data.host + " " + data.method + " " + data.target + "\n";
               report += "   pack request:   " + t(startExecTime - startTime) + " us\n";
               report +=
                   "   load contracts: " + t(endExecTime - startExecTime - tc.getBillableTime()) +
                   " us\n";
               report += "   database:       " + t(tc.databaseTime) + " us\n";
               report +=
                   "   exec wasm:      " + t(tc.getBillableTime() - tc.databaseTime) + " us\n";
               report += "   total:          " + t(endTime - startTime) + " us\n";
               std::cout << report;
            }
            if (!result)
               return send(
                   error(bhttp::status::not_found,
                         "The resource '" + req.target().to_string() + "' was not found.\n"));
            return send(ok(std::move(result->body), result->contentType.c_str(), &result->headers));
         }  // !native
         else if (req.target() == "/native/push_boot" && req.method() == bhttp::verb::post &&
                  server.http_config->push_boot_async)
         {
            server.http_config->push_boot_async(
                std::move(req.body()),
                [error, ok, session = send.self.derived_session().shared_from_this(),
                 server = send.self.server.shared_from_this()](push_boot_result result)
                {
                   // inside foreign thread; the server capture above keeps ioc alive.
                   net::post(
                       session->stream.socket().get_executor(),
                       [error, ok, session = std::move(session), result = std::move(result)]
                       {
                          // inside http thread pool. If we reached here, then the server
                          // and ioc are still alive. This lambda doesn't capture server since
                          // that would leak memory (circular) if the ioc threads were shut down.
                          try
                          {
                             session->queue_.pause_read = false;
                             if (!result)
                                session->queue_(ok({'t', 'r', 'u', 'e'}, "application/json"));
                             else
                                session->queue_(
                                    error(bhttp::status::internal_server_error, *result));
                             if (session->queue_.can_read())
                                session->do_read();
                          }
                          catch (...)
                          {
                             session->do_close();
                          }
                       });
                });
            send.pause_read = true;
            return;
         }  // push_boot
         else if (req.target() == "/native/push_transaction" && req.method() == bhttp::verb::post &&
                  server.http_config->push_transaction_async)
         {
            // TODO: prevent an http timeout from disconnecting or reporting a failure when the transaction was successful
            //       but... that could open up a vulnerability (resource starvation) where the client intentionally doesn't
            //       read and doesn't close the socket.
            server.http_config->push_transaction_async(
                std::move(req.body()),
                [error, ok, session = send.self.derived_session().shared_from_this(),
                 server = send.self.server.shared_from_this()](push_transaction_result result)
                {
                   // inside foreign thread; the server capture above keeps ioc alive.
                   net::post(
                       session->stream.socket().get_executor(),
                       [error, ok, session = std::move(session), result = std::move(result)]
                       {
                          // inside http thread pool. If we reached here, then the server
                          // and ioc are still alive. This lambda doesn't capture server since
                          // that would leak memory (circular) if the ioc threads were shut down.
                          try
                          {
                             session->queue_.pause_read = false;
                             if (auto* trace = std::get_if<TransactionTrace>(&result))
                             {
                                std::vector<char>   data;
                                psio::vector_stream stream{data};
                                psio::to_json(*trace, stream);
                                session->queue_(ok(std::move(data), "application/json"));
                             }
                             else
                             {
                                session->queue_(error(bhttp::status::internal_server_error,
                                                      std::get<std::string>(result)));
                             }
                             if (session->queue_.can_read())
                                session->do_read();
                          }
                          catch (...)
                          {
                             session->do_close();
                          }
                       });
                });
            send.pause_read = true;
            return;
         }  // push_transaction
         else if (req.target() == "/native/p2p" && websocket::is_upgrade(req) &&
                  server.http_config->accept_p2p_websocket)
         {
            // Stop reading HTTP requests
            send.pause_read = true;
            send(websocket_upgrade{}, std::move(req));
            return;
         }
         else if (req.target() == "/native/admin/peers" && req.method() == bhttp::verb::get &&
                  server.http_config->get_peers)
         {
            // returns json list of {id:int,endpoint:string}
            send.pause_read = true;
            server.http_config->get_peers(
                [ok, session = send.self.derived_session().shared_from_this(),
                 server = send.self.server.shared_from_this()](get_peers_result result)
                {
                   net::post(session->stream.socket().get_executor(),
                             [ok, session = std::move(session), result = std::move(result)]()
                             {
                                session->queue_.pause_read = false;
                                std::vector<char>   data;
                                psio::vector_stream stream{data};
                                psio::to_json(result, stream);
                                session->queue_(ok(std::move(data), "application/json"));
                                if (session->queue_.can_read())
                                   session->do_read();
                             });
                });
            return;
         }
         else if (req.target() == "/native/admin/connect" && req.method() == bhttp::verb::post &&
                  server.http_config->connect)
         {
            // takes a string endpoint
            send.pause_read = true;
            server.http_config->connect(
                req.body(),
                [ok_no_content, error, session = send.self.derived_session().shared_from_this(),
                 server = send.self.server.shared_from_this()](connect_result result)
                {
                   net::post(
                       session->stream.socket().get_executor(),
                       [ok_no_content, error, session = std::move(session),
                        result = std::move(result)]()
                       {
                          session->queue_.pause_read = false;
                          if (result)
                          {
                             session->queue_(error(bhttp::status::internal_server_error, *result));
                          }
                          else
                          {
                             session->queue_(ok_no_content());
                          }
                          if (session->queue_.can_read())
                             session->do_read();
                       });
                });
            return;
         }
         else if (req.target() == "/native/admin/disconnect" && req.method() == bhttp::verb::post &&
                  server.http_config->disconnect)
         {
            // takes an integer identifying the peer
            send.pause_read = true;
            server.http_config->disconnect(
                req.body(),
                [ok_no_content, error, session = send.self.derived_session().shared_from_this(),
                 server = send.self.server.shared_from_this()](connect_result result)
                {
                   net::post(
                       session->stream.socket().get_executor(),
                       [ok_no_content, error, session = std::move(session),
                        result = std::move(result)]()
                       {
                          session->queue_.pause_read = false;
                          if (result)
                          {
                             session->queue_(error(bhttp::status::internal_server_error, *result));
                          }
                          else
                          {
                             session->queue_(ok_no_content());
                          }
                          if (session->queue_.can_read())
                             session->do_read();
                       });
                });
            return;
         }
         else
         {
            return send(error(bhttp::status::not_found,
                              "The resource '" + req.target().to_string() + "' was not found.\n"));
         }
      }
      catch (const std::exception& e)
      {
         return send(
             error(bhttp::status::internal_server_error, "exception: " + std::string(e.what())));
      }
      catch (...)
      {
         // TODO: elog("query failed: unknown exception");
         return send(
             error(bhttp::status::internal_server_error, "query failed: unknown exception\n"));
      }
   }  // handle_request

   // Handles an HTTP server connection
   template <typename SessionType>
   class http_session
   {
      // This queue is used for HTTP pipelining.
      class queue
      {
         enum
         {
            // Maximum number of responses we will queue
            limit = 8
         };

         // The type-erased, saved work item
         struct work
         {
            virtual ~work()           = default;
            virtual void operator()() = 0;
         };

         std::vector<std::unique_ptr<work>> items;

        public:
         http_session& self;
         bool          pause_read = false;

         explicit queue(http_session& self) : self(self)
         {
            static_assert(limit > 0, "queue limit must be positive");
            items.reserve(limit);
         }

         // Returns `true` if we have reached the queue limit
         bool is_full() const { return items.size() >= limit; }

         bool can_read() const { return !is_full() && !pause_read; }

         // Called when a message finishes sending
         // Returns `true` if the caller should initiate a read
         bool on_write()
         {
            BOOST_ASSERT(!items.empty());
            const auto was_full = is_full();
            items.erase(items.begin());
            if (!items.empty())
               (*items.front())();
            return was_full && !pause_read;
         }

         // Called by the HTTP handler to send a response.
         template <bool isRequest, class Body, class Fields>
         void operator()(bhttp::message<isRequest, Body, Fields>&& msg)
         {
            // This holds a work item
            struct work_impl : work
            {
               http_session&                           self;
               bhttp::message<isRequest, Body, Fields> msg;

               work_impl(http_session& self, bhttp::message<isRequest, Body, Fields>&& msg)
                   : self(self), msg(std::move(msg))
               {
               }

               void operator()()
               {
                  bhttp::async_write(
                      self.derived_session().stream, msg,
                      beast::bind_front_handler(&http_session::on_write,
                                                self.derived_session().shared_from_this(),
                                                msg.need_eof()));
               }
            };

            // Allocate and store the work
            items.push_back(boost::make_unique<work_impl>(self, std::move(msg)));

            // If there was no previous work, start this one
            if (items.size() == 1)
               (*items.front())();
         }
         template <class Msg>
         void operator()(websocket_upgrade, Msg&& msg)
         {
            struct work_impl : work
            {
               http_session& self;
               Msg           request;

               work_impl(http_session& self, Msg&& msg) : self(self), request(std::move(msg)) {}
               void operator()()
               {
                  struct op
                  {
                     Msg                                                        request;
                     websocket::stream<decltype(self.derived_session().stream)> stream;
                  };

                  auto ptr =  std::make_shared<op>( op{std::move(request), websocket::stream<decltype(self.derived_session().stream)>{ std::move(self.derived_session().stream)}}); 
                  
                  auto p = ptr.get();
                  // Capture server, not self, because after returning, there is
                  // no longer anything keeping the session alive
                  p->stream.async_accept(
                      p->request,
                      [ptr = std::move(ptr), &server = self.server](const std::error_code& ec)
                      {
                         if (!ec)
                         {
                            // FIXME: handle local sockets
                            if constexpr (std::is_same_v<decltype(self.derived_session().stream),
                                                         beast::tcp_stream>)
                            {
                               server.http_config->accept_p2p_websocket(std::move(ptr->stream));
                            }
                         }
                      });
               }
            };

            // Allocate and store the work
            items.push_back(boost::make_unique<work_impl>(self, std::move(msg)));

            // If there was no previous work, start this one
            if (items.size() == 1)
               (*items.front())();
         }
      };

      beast::flat_buffer                 buffer;
      std::unique_ptr<net::steady_timer> _timer;
      steady_clock::time_point           last_activity_timepoint;

      // The parser is stored in an optional container so we can
      // construct it from scratch it at the beginning of each new message.
      boost::optional<bhttp::request_parser<bhttp::vector_body<char>>> parser;

     public:
      server_impl& server;
      queue        queue_;

      http_session(server_impl& server) : server(server), queue_(*this) {}

      // Start the session
      void run()
      {
         _timer.reset(
             new boost::asio::steady_timer(derived_session().stream.socket().get_executor()));
         last_activity_timepoint = steady_clock::now();
         start_socket_timer();
         do_read();
      }

      SessionType& derived_session() { return static_cast<SessionType&>(*this); }

     private:
      void start_socket_timer()
      {
         _timer->expires_after(server.http_config->idle_timeout_ms);
         _timer->async_wait(
             [this](beast::error_code ec)
             {
                if (ec)
                {
                   return;
                }
                auto session_duration = steady_clock::now() - last_activity_timepoint;
                if (session_duration <= server.http_config->idle_timeout_ms)
                {
                   start_socket_timer();
                }
                else
                {
                   ec = beast::error::timeout;
                   fail(ec, "timeout");
                   return do_close();
                }
             });
      }

     public:
      void do_read()
      {
         // Construct a new parser for each message
         parser.emplace();

         // Apply a reasonable limit to the allowed size
         // of the body in bytes to prevent abuse.
         parser->body_limit(server.http_config->max_request_size);
         last_activity_timepoint = steady_clock::now();
         // Read a request using the parser-oriented interface
         bhttp::async_read(derived_session().stream, buffer, *parser,
                           beast::bind_front_handler(&http_session::on_read,
                                                     derived_session().shared_from_this()));
      }

     private:
      void on_read(beast::error_code ec, std::size_t bytes_transferred)
      {
         boost::ignore_unused(bytes_transferred);

         // This means they closed the connection
         if (ec == bhttp::error::end_of_stream)
            return do_close();

         if (ec)
         {
            fail(ec, "read");
            return do_close();
         }

         // Send the response
         handle_request(server, parser->release(), queue_);

         // If we aren't at the queue limit, try to pipeline another request
         if (queue_.can_read())
            do_read();
      }

      void on_write(bool close, beast::error_code ec, std::size_t bytes_transferred)
      {
         boost::ignore_unused(bytes_transferred);

         if (ec)
         {
            fail(ec, "write");
            return do_close();
         }

         if (close)
         {
            // This means we should close the connection, usually because
            // the response indicated the "Connection: close" semantic.
            return do_close();
         }

         // Inform the queue that a write completed
         if (queue_.on_write())
         {
            // Read another request
            do_read();
         }
      }

     public:
      void do_close()
      {
         // Send a TCP shutdown
         beast::error_code ec;
         derived_session().stream.socket().shutdown(tcp::socket::shutdown_send, ec);
         _timer->cancel();  // cancel connection timer.
         // At this point the connection is closed gracefully
      }
   };  // http_session

   struct tcp_http_session : public http_session<tcp_http_session>,
                             public std::enable_shared_from_this<tcp_http_session>
   {
      tcp_http_session(server_impl& server, tcp::socket&& socket)
          : http_session<tcp_http_session>(server), stream(std::move(socket))
      {
      }

      beast::tcp_stream stream;
   };

   struct unix_http_session : public http_session<unix_http_session>,
                              public std::enable_shared_from_this<unix_http_session>
   {
      unix_http_session(server_impl& server, unixs::socket&& socket)
          : http_session<unix_http_session>(server), stream(std::move(socket))
      {
      }

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
   class listener : public std::enable_shared_from_this<listener>
   {
      server_impl&    server;
      tcp::acceptor   tcp_acceptor;
      unixs::acceptor unix_acceptor;
      bool            acceptor_ready = false;

     public:
      listener(server_impl& server)
          : server(server),
            tcp_acceptor(net::make_strand(server.ioc)),
            unix_acceptor(net::make_strand(server.ioc))
      {
         if (server.http_config->address.size())
         {
            boost::asio::ip::address a;
            try
            {
               a = net::ip::make_address(server.http_config->address);
            }
            catch (std::exception& e)
            {
               throw std::runtime_error("make_address(): "s + server.http_config->address + ": " +
                                        e.what());
            }

            start_listen(tcp_acceptor, tcp::endpoint{a, server.http_config->port});
         }

         if (server.http_config->unix_path.size())
         {
            //take a sniff and see if anything is already listening at the given socket path, or if the socket path exists
            // but nothing is listening
            boost::system::error_code test_ec;
            unixs::socket             test_socket(server.ioc);
            test_socket.connect(server.http_config->unix_path.c_str(), test_ec);

            //looks like a service is already running on that socket, don't touch it... fail out
            if (test_ec == boost::system::errc::success)
               check(false, "wasmql http unix socket is in use");
            //socket exists but no one home, go ahead and remove it and continue on
            else if (test_ec == boost::system::errc::connection_refused)
               ::unlink(server.http_config->unix_path.c_str());
            else if (test_ec != boost::system::errc::no_such_file_or_directory)
               check(false, "unexpected failure when probing existing wasmql http unix socket: " +
                                test_ec.message());

            start_listen(unix_acceptor, unixs::endpoint(server.http_config->unix_path));
         }

         acceptor_ready = true;
      }

      template <typename Acceptor, typename Endpoint>
      void start_listen(Acceptor& acceptor, const Endpoint& endpoint)
      {
         beast::error_code ec;

         auto check_ec = [&](const char* what)
         {
            if (!ec)
               return;
            // TODO: elog("${w}: ${m}", ("w", what)("m", ec.message()));
            check(false, "unable to open listen socket");
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
      bool run()
      {
         if (!acceptor_ready)
            return acceptor_ready;
         if (tcp_acceptor.is_open())
            do_accept(tcp_acceptor);
         if (unix_acceptor.is_open())
            do_accept(unix_acceptor);
         return acceptor_ready;
      }

     private:
      template <typename Acceptor>
      void do_accept(Acceptor& acceptor)
      {
         // The new connection gets its own strand
         acceptor.async_accept(
             net::make_strand(server.ioc),
             beast::bind_front_handler(
                 [&acceptor, self = shared_from_this(), this](beast::error_code ec,
                                                              auto              socket) mutable
                 {
                    if (ec)
                    {
                       fail(ec, "accept");
                    }
                    else
                    {
                       // Create the http session and run it
                       if constexpr (std::is_same_v<Acceptor, tcp::acceptor>)
                       {
                          boost::system::error_code ec;
                          // TODO:
                          // dlog("Accepting connection from ${ra}:${rp} to ${la}:${lp}",
                          //      ("ra", socket.remote_endpoint(ec).address().to_string())(
                          //          "rp", socket.remote_endpoint(ec).port())(
                          //          "la", socket.local_endpoint(ec).address().to_string())(
                          //          "lp", socket.local_endpoint(ec).port()));
                          std::make_shared<tcp_http_session>(self->server, std::move(socket))
                              ->run();
                       }
                       else if constexpr (std::is_same_v<Acceptor, unixs::acceptor>)
                       {
                          boost::system::error_code ec;
                          auto                      rep = socket.remote_endpoint(ec);
                          // TODO: dlog("Accepting connection from ${r}", ("r", rep.path()));
                          std::make_shared<unix_http_session>(self->server, std::move(socket))
                              ->run();
                       }
                    }

                    // Accept another connection
                    do_accept(acceptor);
                 }));
      }
   };  // listener

   bool server_impl::start()
   {
      auto l = std::make_shared<listener>(*this);
      if (!l->run())
         return false;

      threads.reserve(http_config->num_threads);
      for (unsigned i = 0; i < http_config->num_threads; ++i)
         threads.emplace_back([self = shared_from_this()] { self->ioc.run(); });
      return true;
   }

   std::shared_ptr<server> server::create(const std::shared_ptr<const http_config>& http_config,
                                          const std::shared_ptr<SharedState>&       sharedState)
   {
      check(http_config->num_threads > 0, "too few threads");
      auto server = std::make_shared<server_impl>(http_config, sharedState);
      if (server->start())
         return server;
      else
         return nullptr;
   }

}  // namespace psibase::http
