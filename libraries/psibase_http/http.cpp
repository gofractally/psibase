// Adapted from Boost Beast Advanced Server example
//
// Copyright (c) 2016-2019 Vinnie Falco (vinnie dot falco at gmail dot com)
//
// Distributed under the Boost Software License, Version 1.0. (See accompanying
// file LICENSE_1_0.txt or copy at http://www.boost.org/LICENSE_1_0.txt)

#include "psibase/http.hpp"
#include "psibase/TransactionContext.hpp"
#include "psibase/log.hpp"
#include "psibase/serviceEntry.hpp"

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
#include <boost/signals2/signal.hpp>

#include <psio/finally.hpp>
#include <psio/to_json.hpp>

#include <algorithm>
#include <cstdlib>
#include <fstream>
#include <functional>
#include <iostream>
#include <memory>
#include <mutex>
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

   struct server_impl
   {
      net::io_service                          ioc;
      std::shared_ptr<const http::http_config> http_config = {};
      std::shared_ptr<psibase::SharedState>    sharedState = {};
      std::vector<std::thread>                 threads     = {};
      using signal_type                                    = boost::signals2::signal<void(bool)>;
      signal_type      shutdown_connections;
      shutdown_tracker thread_count;

      server_impl(const std::shared_ptr<const http::http_config>& http_config,
                  const std::shared_ptr<psibase::SharedState>&    sharedState)
          : http_config{http_config}, sharedState{sharedState}
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

      template <typename T>
      void register_connection(const std::shared_ptr<T>& ptr)
      {
         shutdown_connections.connect(
             signal_type::slot_type([weak = std::weak_ptr{ptr}](bool restart)
                                    { T::close(weak.lock(), restart); })
                 .track_foreign(std::weak_ptr{ptr}));
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

   template <typename T>
   constexpr std::size_t function_arg_count = 0;

   template <typename R, typename... T>
   constexpr std::size_t function_arg_count<std::function<R(T...)>> = sizeof...(T);

   // Reads log records from the queue and writes them to a websocket
   template <typename StreamType>
   class websocket_log_session
   {
     public:
      explicit websocket_log_session(StreamType&& stream)
          : reader(stream.get_executor()), stream(std::move(stream))
      {
      }
      static void write(std::shared_ptr<websocket_log_session>&& self)
      {
         auto p = self.get();
         p->reader.async_read(
             [self = std::move(self)](const std::error_code& ec, std::span<const char> data) mutable
             {
                if (!ec && !self->closed)
                {
                   auto p = self.get();
                   p->stream.async_write(
                       boost::asio::buffer(data.data(), data.size()),
                       [self = std::move(self)](const std::error_code& ec, std::size_t) mutable
                       {
                          if (!ec && !self->closed)
                          {
                             auto p = self.get();
                             write(std::move(self));
                          }
                       });
                }
             });
      }
      static void read(std::shared_ptr<websocket_log_session>&& self)
      {
         auto p = self.get();
         p->buffer.clear();
         p->stream.async_read(
             p->buffer,
             [self = std::move(self)](const std::error_code& ec, std::size_t) mutable
             {
                if (!ec)
                {
                   auto data = self->buffer.cdata();
                   try
                   {
                      self->reader.config({static_cast<const char*>(data.data()), data.size()});
                   }
                   catch (std::exception& e)
                   {
                      close(std::move(self), {websocket::close_code::policy_error, e.what()});
                      return;
                   }
                   read(std::move(self));
                }
             });
      }
      static void run(std::shared_ptr<websocket_log_session>&& self)
      {
         read(std::shared_ptr(self));
         write(std::move(self));
      }

      static void close(std::shared_ptr<websocket_log_session>&& self,
                        websocket::close_reason                  reason)
      {
         if (!self->closed)
         {
            self->closed = true;
            self->reader.cancel();
            auto p = self.get();
            p->stream.async_close(reason, [self = std::move(self)](const std::error_code&) {});
         }
      }

      static void close(std::shared_ptr<websocket_log_session>&& self, bool restart)
      {
         auto p = self.get();
         boost::asio::dispatch(
             p->stream.get_executor(),
             [restart, self = std::move(self)]() mutable
             {
                close(std::move(self),
                      websocket::close_reason{restart ? websocket::close_code::service_restart
                                                      : websocket::close_code::going_away});
             });
      }

     private:
      bool                        closed = false;
      psibase::loggers::LogReader reader;
      StreamType                  stream;
      beast::flat_buffer          buffer;
   };

   beast::string_view remove_scheme(beast::string_view origin)
   {
      auto pos = origin.find("://");
      if (pos != beast::string_view::npos)
      {
         return origin.substr(pos + 3);
      }
      return origin;
   }

   beast::string_view deport(beast::string_view host)
   {
      if (auto pos = host.rfind(':'); pos != std::string::npos)
      {
         if (host.find(']', pos) == std::string::npos)
         {
            return host.substr(0, pos);
         }
      }
      return host;
   }

   bool is_admin(admin_none, const http_config&, beast::string_view)
   {
      return false;
   }

   bool is_admin(admin_any, const http_config&, beast::string_view)
   {
      return true;
   }

   bool is_admin(admin_any_native, const http_config& cfg, beast::string_view host)
   {
      return cfg.services.find(host) != cfg.services.end();
   }

   bool is_admin(AccountNumber admin, const http_config& cfg, beast::string_view host)
   {
      if (host.size() > cfg.host.size() && host.ends_with(cfg.host) &&
          host[host.size() - cfg.host.size() - 1] == '.')
      {
         return admin.str() == host.substr(0, host.size() - cfg.host.size() - 1);
      }
      else
      {
         return false;
      }
   }

   bool is_admin(const http_config& cfg, beast::string_view host)
   {
      return std::visit([&](const auto& admin) { return is_admin(admin, cfg, host); }, cfg.admin);
   }

   template <class Body, class Allocator>
   bool is_admin(const http_config& cfg, bhttp::request<Body, bhttp::basic_fields<Allocator>>& req)
   {
      return is_admin(cfg, deport(req.at(bhttp::field::host)));
   }

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
      bool     req_allow_cors = !req.target().starts_with("/native/");

      const auto set_cors = [&server, req_allow_cors](auto& res)
      {
         if (!server.http_config->allow_origin.empty() && req_allow_cors)
         {
            res.set(bhttp::field::access_control_allow_origin, server.http_config->allow_origin);
            res.set(bhttp::field::access_control_allow_methods, "POST, GET, OPTIONS");
            res.set(bhttp::field::access_control_allow_headers, "*");
         }
      };

      const auto set_keep_alive = [&server, req_keep_alive](auto& res)
      {
         bool keep_alive = req_keep_alive && !server.http_config->status.load().shutdown;
         res.keep_alive(keep_alive);
         if (keep_alive)
         {
            auto sec = std::chrono::duration_cast<std::chrono::seconds>(
                           server.http_config->idle_timeout_ms)
                           .count();
            res.set(bhttp::field::keep_alive, "timeout=" + std::to_string(sec));
         }
      };

      // Returns a bad request response
      const auto bad_request =
          [&server, set_cors, req_version, set_keep_alive](beast::string_view why)
      {
         bhttp::response<bhttp::string_body> res{bhttp::status::bad_request, req_version};
         res.set(bhttp::field::server, BOOST_BEAST_VERSION_STRING);
         res.set(bhttp::field::content_type, "text/html");
         set_cors(res);
         set_keep_alive(res);
         res.body() = why.to_string();
         res.prepare_payload();
         return res;
      };

      // Returns a method_not_allowed response
      const auto method_not_allowed = [&server, set_cors, req_version, set_keep_alive](
                                          beast::string_view target, beast::string_view method,
                                          beast::string_view allowed_methods)
      {
         bhttp::response<bhttp::string_body> res{bhttp::status::method_not_allowed, req_version};
         res.set(bhttp::field::server, BOOST_BEAST_VERSION_STRING);
         res.set(bhttp::field::content_type, "text/html");
         res.set(bhttp::field::allow, allowed_methods);
         set_cors(res);
         set_keep_alive(res);
         res.body() = "The resource '" + target.to_string() + "' does not accept the method " +
                      method.to_string() + ".";
         res.prepare_payload();
         return res;
      };

      // Returns a not found response
      const auto not_found =
          [&server, set_cors, req_version, set_keep_alive](beast::string_view target)
      {
         bhttp::response<bhttp::string_body> res{bhttp::status::not_found, req_version};
         res.set(bhttp::field::server, BOOST_BEAST_VERSION_STRING);
         res.set(bhttp::field::content_type, "text/html");
         set_cors(res);
         set_keep_alive(res);
         res.body() = "The resource '" + target.to_string() + "' was not found.";
         res.prepare_payload();
         return res;
      };

      // Returns an error response
      const auto error =
          [&server, set_cors, req_version, set_keep_alive](
              bhttp::status status, beast::string_view why, const char* content_type = "text/html")
      {
         bhttp::response<bhttp::string_body> res{status, req_version};
         res.set(bhttp::field::server, BOOST_BEAST_VERSION_STRING);
         res.set(bhttp::field::content_type, content_type);
         set_cors(res);
         set_keep_alive(res);
         res.body() = why.to_string();
         res.prepare_payload();
         return res;
      };

      const auto ok = [&server, set_cors, req_version, set_keep_alive](
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
         set_keep_alive(res);
         res.body() = std::move(reply);
         res.prepare_payload();
         return res;
      };

      const auto ok_no_content = [&server, set_cors, req_version, set_keep_alive]()
      {
         bhttp::response<bhttp::vector_body<char>> res{bhttp::status::ok, req_version};
         res.set(bhttp::field::server, BOOST_BEAST_VERSION_STRING);
         set_cors(res);
         set_keep_alive(res);
         res.prepare_payload();
         return res;
      };

      const auto accepted = [&server, set_cors, req_version, set_keep_alive]()
      {
         bhttp::response<bhttp::vector_body<char>> res{bhttp::status::accepted, req_version};
         res.set(bhttp::field::server, BOOST_BEAST_VERSION_STRING);
         set_cors(res);
         set_keep_alive(res);
         res.prepare_payload();
         return res;
      };

      // Used for requests that are not subject to CORS such as websockets
      auto forbid_cross_origin = [&req, &send, &error]()
      {
         if (auto iter = req.find(bhttp::field::origin); iter != req.end())
         {
            const auto& host   = req[bhttp::field::host];
            const auto& origin = iter->value();
            if (origin == "null" || remove_scheme(origin) != host)
            {
               send(error(bhttp::status::bad_request, "Cross origin request refused"));
               return true;
            }
         }
         return false;
      };

      const auto run_native_handler = [&send, &req](auto&& request_handler, auto&& callback)
      {
         send.pause_read = true;
         auto post_back_to_http =
             [callback = static_cast<decltype(callback)>(callback),
              session  = send.self.derived_session().shared_from_this()](auto&& result) mutable
         {
            auto* p = session.get();
            net::post(p->stream.socket().get_executor(),
                      [callback = std::move(callback), session = std::move(session),
                       result = static_cast<decltype(result)>(result)]()
                      {
                         session->queue_.pause_read = false;
                         callback(std::move(result));
                         if (session->queue_.can_read())
                            session->do_read();
                      });
         };
         if constexpr (function_arg_count<std::remove_cvref_t<decltype(request_handler)>> == 2)
         {
            request_handler(std::move(req.body()), std::move(post_back_to_http));
         }
         else
         {
            request_handler(std::move(post_back_to_http));
         }
      };

      try
      {
         if (!req.target().starts_with("/native"))
         {
            auto host = deport(req.at(bhttp::field::host));

            std::shared_lock l{server.http_config->mutex};
            if (auto iter = server.http_config->services.find(host);
                iter != server.http_config->services.end())
            {
               auto file = iter->second.find(req.target());
               if (file != iter->second.end())
               {
                  if (req.method() == bhttp::verb::options)
                  {
                     return send(ok_no_content());
                  }
                  else if (req.method() != bhttp::verb::get)
                  {
                     return send(
                         method_not_allowed(req.target(), req.method_string(), "GET, OPTIONS"));
                  }

                  std::vector<char> contents;
                  // read file
                  auto          size = std::filesystem::file_size(file->second.path);
                  std::ifstream in(file->second.path, std::ios_base::binary);
                  l.unlock();
                  contents.resize(size);
                  in.read(contents.data(), contents.size());
                  return send(ok(std::move(contents), file->second.content_type.c_str()));
               }
               else
               {
                  return send(not_found(req.target()));
               }
            }

            if (server.http_config->host.empty())
               return send(not_found(req.target()));

            if (req.method() == bhttp::verb::options)
            {
               return send(ok_no_content());
            }

            auto        startTime = steady_clock::now();
            HttpRequest data;
            if (req.method() == bhttp::verb::get)
               data.method = "GET";
            else if (req.method() == bhttp::verb::post)
               data.method = "POST";
            else
               return send(
                   method_not_allowed(req.target(), req.method_string(), "GET, POST, OPTIONS"));
            data.host        = {host.begin(), host.size()};
            data.rootHost    = server.http_config->host;
            data.target      = req.target().to_string();
            data.contentType = (std::string)req[bhttp::field::content_type];
            data.body        = std::move(req.body());

            // Do not use any reconfigurable members of server.http_config after this point
            l.unlock();

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
                           .sender  = AccountNumber(),
                           .service = proxyServiceNum,
                           .rawData = psio::convert_to_frac(data),
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

            // TODO: consider bundling into a single attribute
            BOOST_LOG_SCOPED_LOGGER_TAG(
                send.self.logger, "PackTime",
                std::chrono::duration_cast<std::chrono::microseconds>(startExecTime - startTime));
            BOOST_LOG_SCOPED_LOGGER_TAG(send.self.logger, "ServiceLoadTime",
                                        std::chrono::duration_cast<std::chrono::microseconds>(
                                            endExecTime - startExecTime - tc.getBillableTime()));
            BOOST_LOG_SCOPED_LOGGER_TAG(
                send.self.logger, "DatabaseTime",
                std::chrono::duration_cast<std::chrono::microseconds>(tc.databaseTime));
            BOOST_LOG_SCOPED_LOGGER_TAG(send.self.logger, "WasmExecTime",
                                        std::chrono::duration_cast<std::chrono::microseconds>(
                                            tc.getBillableTime() - tc.databaseTime));
            BOOST_LOG_SCOPED_LOGGER_TAG(
                send.self.logger, "ResponseTime",
                std::chrono::duration_cast<std::chrono::microseconds>(endTime - startTime));
            if (!result)
               return send(
                   error(bhttp::status::not_found,
                         "The resource '" + req.target().to_string() + "' was not found.\n"));
            return send(ok(std::move(result->body), result->contentType.c_str(), &result->headers));
         }  // !native
         else if (req.target() == "/native/push_boot" && server.http_config->push_boot_async)
         {
            if (!server.http_config->enable_transactions)
               return send(not_found(req.target()));

            if (req.method() != bhttp::verb::post)
            {
               return send(method_not_allowed(req.target(), req.method_string(), "POST"));
            }

            if (auto content_type = req.find(bhttp::field::content_type); content_type != req.end())
            {
               if (content_type->value() != "application/octet-stream")
               {
                  return send(error(bhttp::status::unsupported_media_type,
                                    "Content-Type must be application/octet-stream\n"));
               }
            }

            if (forbid_cross_origin())
            {
               return;
            }

            server.http_config->push_boot_async(
                std::move(req.body()),
                [error, ok,
                 session = send.self.derived_session().shared_from_this()](push_boot_result result)
                {
                   net::post(session->stream.socket().get_executor(),
                             [error, ok, session = std::move(session), result = std::move(result)]
                             {
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
         else if (req.target() == "/native/push_transaction" &&
                  server.http_config->push_transaction_async)
         {
            if (!server.http_config->enable_transactions)
               return send(not_found(req.target()));

            if (req.method() != bhttp::verb::post)
            {
               return send(method_not_allowed(req.target(), req.method_string(), "POST"));
            }

            if (auto content_type = req.find(bhttp::field::content_type); content_type != req.end())
            {
               if (content_type->value() != "application/octet-stream")
               {
                  return send(error(bhttp::status::unsupported_media_type,
                                    "Content-Type must be application/octet-stream\n"));
               }
            }

            if (forbid_cross_origin())
            {
               return;
            }

            // TODO: prevent an http timeout from disconnecting or reporting a failure when the transaction was successful
            //       but... that could open up a vulnerability (resource starvation) where the client intentionally doesn't
            //       read and doesn't close the socket.
            server.http_config->push_transaction_async(
                std::move(req.body()),
                [error, ok, session = send.self.derived_session().shared_from_this()](
                    push_transaction_result result)
                {
                   net::post(session->stream.socket().get_executor(),
                             [error, ok, session = std::move(session), result = std::move(result)]
                             {
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
                  server.http_config->accept_p2p_websocket && server.http_config->enable_p2p)
         {
            if (forbid_cross_origin())
               return;
            // Stop reading HTTP requests
            send.pause_read = true;
            send(websocket_upgrade{}, std::move(req), server.http_config->accept_p2p_websocket);
            return;
         }
         else if (req.target() == "/native/admin/status")
         {
            if (!is_admin(*server.http_config, req))
            {
               return send(not_found(req.target()));
            }
            if (req.method() == bhttp::verb::get)
            {
               auto status = server.http_config->status.load();
               //
               std::vector<char>   body;
               psio::vector_stream stream{body};
               to_json(status, stream);
               send(ok(std::move(body), "application/json"));
            }
            else
            {
               send(method_not_allowed(req.target(), req.method_string(), "GET"));
            }
         }
         else if (req.target() == "/native/admin/shutdown")
         {
            if (!is_admin(*server.http_config, req))
            {
               return send(not_found(req.target()));
            }
            if (req.method() != bhttp::verb::post)
            {
               return send(method_not_allowed(req.target(), req.method_string(), "POST"));
            }
            if (req[bhttp::field::content_type] != "application/json")
            {
               return send(error(bhttp::status::unsupported_media_type,
                                 "Content-Type must be application/json\n"));
            }
            server.http_config->shutdown(std::move(req.body()));
            return send(accepted());
         }
         else if (req.target() == "/native/admin/peers" && server.http_config->get_peers)
         {
            if (!is_admin(*server.http_config, req))
            {
               return send(not_found(req.target()));
            }
            if (req.method() != bhttp::verb::get)
            {
               return send(method_not_allowed(req.target(), req.method_string(), "GET"));
            }

            // returns json list of {id:int,endpoint:string}
            send.pause_read = true;
            server.http_config->get_peers(
                [ok,
                 session = send.self.derived_session().shared_from_this()](get_peers_result result)
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
         else if (req.target() == "/native/admin/connect" && server.http_config->connect)
         {
            if (!is_admin(*server.http_config, req))
            {
               return send(not_found(req.target()));
            }
            if (req.method() != bhttp::verb::post)
            {
               return send(method_not_allowed(req.target(), req.method_string(), "POST"));
            }

            if (req[bhttp::field::content_type] != "application/json")
            {
               send(error(bhttp::status::unsupported_media_type,
                          "Content-Type must be application/json\n"));
               return;
            }

            send.pause_read = true;
            server.http_config->connect(
                req.body(),
                [ok_no_content, error,
                 session = send.self.derived_session().shared_from_this()](connect_result result)
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
         else if (req.target() == "/native/admin/disconnect" && server.http_config->disconnect)
         {
            if (!is_admin(*server.http_config, req))
            {
               return send(not_found(req.target()));
            }
            if (req.method() != bhttp::verb::post)
            {
               return send(method_not_allowed(req.target(), req.method_string(), "POST"));
            }

            if (req[bhttp::field::content_type] != "application/json")
            {
               send(error(bhttp::status::unsupported_media_type,
                          "Content-Type must be application/json\n"));
               return;
            }

            send.pause_read = true;
            server.http_config->disconnect(
                req.body(),
                [ok_no_content, error,
                 session = send.self.derived_session().shared_from_this()](connect_result result)
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
         else if (req.target() == "/native/admin/log" && websocket::is_upgrade(req))
         {
            if (!is_admin(*server.http_config, req))
               return send(not_found(req.target()));
            if (forbid_cross_origin())
               return;
            send.pause_read = true;
            send(websocket_upgrade{}, std::move(req),
                 [&server](auto&& stream)
                 {
                    using stream_type = std::decay_t<decltype(stream)>;
                    auto session =
                        std::make_shared<websocket_log_session<stream_type>>(std::move(stream));
                    server.register_connection(session);
                    websocket_log_session<stream_type>::run(std::move(session));
                 });
         }
         else if (req.target() == "/native/admin/config")
         {
            if (!is_admin(*server.http_config, req))
            {
               return send(not_found(req.target()));
            }
            if (req.method() == bhttp::verb::get)
            {
               run_native_handler(server.http_config->get_config,
                                  [ok, session = send.self.derived_session().shared_from_this()](
                                      auto&& make_result)
                                  { session->queue_(ok(make_result(), "application/json")); });
            }
            else if (req.method() == bhttp::verb::put)
            {
               if (req[bhttp::field::content_type] != "application/json")
               {
                  return send(error(bhttp::status::unsupported_media_type,
                                    "Content-Type must be application/json\n"));
               }
               run_native_handler(
                   server.http_config->set_config,
                   [error, ok_no_content,
                    session = send.self.derived_session().shared_from_this()](auto&& result)
                   {
                      if (result)
                      {
                         session->queue_(error(bhttp::status::internal_server_error, *result));
                      }
                      else
                      {
                         session->queue_(ok_no_content());
                      }
                   });
            }
            else
            {
               send(method_not_allowed(req.target(), req.method_string(), "GET, PUT"));
            }
            return;
         }
         else if (req.target() == "/native/admin/keys")
         {
            if (req.method() == bhttp::verb::get)
            {
               run_native_handler(server.http_config->get_keys,
                                  [ok, session = send.self.derived_session().shared_from_this()](
                                      auto&& make_result)
                                  { session->queue_(ok(make_result(), "application/json")); });
            }
            else if (req.method() == bhttp::verb::post)
            {
               if (req[bhttp::field::content_type] != "application/json")
               {
                  return send(error(bhttp::status::unsupported_media_type,
                                    "Content-Type must be application/json\n"));
               }

               run_native_handler(
                   server.http_config->new_key,
                   [error, ok,
                    session = send.self.derived_session().shared_from_this()](auto&& result)
                   {
                      if (auto err = std::get_if<std::string>(&result))
                      {
                         session->queue_(error(bhttp::status::internal_server_error, *err));
                      }
                      else
                      {
                         session->queue_(ok(std::get<1>(result)(), "application/json"));
                      }
                   });
            }
            else
            {
               send(method_not_allowed(req.target(), req.method_string(), "GET, POST"));
            }
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

            {
               BOOST_LOG_SCOPED_LOGGER_TAG(self.logger, "ResponseStatus",
                                           static_cast<unsigned>(msg.result_int()));
               BOOST_LOG_SCOPED_LOGGER_ATTR(self.logger, "ResponseBytes",
                                            boost::log::attributes::constant<std::uint64_t>(
                                                msg.payload_size() ? *msg.payload_size() : 0));
               PSIBASE_LOG(self.logger, info) << "Handled HTTP request";
               self.request_attrs.reset();
            }

            // Allocate and store the work
            items.push_back(boost::make_unique<work_impl>(self, std::move(msg)));

            // If there was no previous work, start this one
            if (items.size() == 1)
               (*items.front())();
         }
         template <class Msg, typename F>
         void operator()(websocket_upgrade, Msg&& msg, F&& f)
         {
            struct work_impl : work
            {
               http_session&   self;
               Msg             request;
               std::decay_t<F> next;

               work_impl(http_session& self, Msg&& msg, F&& f)
                   : self(self), request(std::move(msg)), next(std::move(f))
               {
               }
               void operator()()
               {
                  struct op
                  {
                     Msg                                                        request;
                     websocket::stream<decltype(self.derived_session().stream)> stream;
                     std::decay_t<F>                                            next;
                  };

                  auto ptr = std::make_shared<op>(
                      op{std::move(request),
                         websocket::stream<decltype(self.derived_session().stream)>{
                             std::move(self.derived_session().stream)},
                         std::move(next)});

                  auto p = ptr.get();
                  // Capture only the stream, not self, because after returning, there is
                  // no longer anything keeping the session alive
                  p->stream.async_accept(
                      p->request,
                      [ptr = std::move(ptr)](const std::error_code& ec)
                      {
                         if (!ec)
                         {
                            // FIXME: handle local sockets
                            if constexpr (std::is_same_v<decltype(self.derived_session().stream),
                                                         beast::tcp_stream>)
                            {
                               ptr->next(std::move(ptr->stream));
                            }
                         }
                      });
               }
            };

            {
               BOOST_LOG_SCOPED_LOGGER_TAG(
                   self.logger, "ResponseStatus",
                   static_cast<unsigned>(bhttp::status::switching_protocols));
               PSIBASE_LOG(self.logger, info) << "Handled HTTP request";
               self.request_attrs.reset();
            }

            // Allocate and store the work
            items.push_back(
                boost::make_unique<work_impl>(self, std::move(msg), std::forward<F>(f)));

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

      psibase::loggers::common_logger logger;
      using scoped_attribute = decltype(boost::log::add_scoped_logger_attribute(
          logger,
          std::string(),
          boost::log::attributes::constant{std::string()}));
      std::optional<std::tuple<scoped_attribute, scoped_attribute, scoped_attribute>> request_attrs;

      http_session(server_impl& server) : server(server), queue_(*this)
      {
         logger.add_attribute("Channel", boost::log::attributes::constant(std::string("http")));
      }

      ~http_session() { PSIBASE_LOG(logger, debug) << "Connection closed"; }

      // Start the session
      void run()
      {
         PSIBASE_LOG(logger, debug) << "Accepted connection";
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
                   PSIBASE_LOG(logger, info) << "Idle connection closed";
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
            fail(logger, ec, "read");
            return do_close();
         }

         {
            const auto& req = parser->get();
            request_attrs.emplace(std::tuple{
                boost::log::add_scoped_logger_attribute(
                    logger, "RequestMethod",
                    boost::log::attributes::constant{std::string(req.method_string())}),
                boost::log::add_scoped_logger_attribute(
                    logger, "RequestTarget",
                    boost::log::attributes::constant{std::string(req.target())}),
                boost::log::add_scoped_logger_attribute(
                    logger, "RequestHost",
                    boost::log::attributes::constant{std::string(req[bhttp::field::host])})});
            PSIBASE_LOG(logger, debug) << "Received HTTP request";
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
            fail(logger, ec, "write");
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
         std::ostringstream ss;
         ss << stream.socket().remote_endpoint();
         logger.add_attribute("RemoteEndpoint",
                              boost::log::attributes::constant<std::string>(ss.str()));
      }

      beast::tcp_stream stream;
   };

   struct unix_http_session : public http_session<unix_http_session>,
                              public std::enable_shared_from_this<unix_http_session>
   {
      unix_http_session(server_impl& server, unixs::socket&& socket)
          : http_session<unix_http_session>(server), stream(std::move(socket))
      {
         logger.add_attribute("RemoteEndpoint", boost::log::attributes::constant<std::string>(
                                                    socket.remote_endpoint().path()));
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

      psibase::loggers::common_logger logger;

     public:
      listener(server_impl& server)
          : server(server),
            tcp_acceptor(net::make_strand(server.ioc)),
            unix_acceptor(net::make_strand(server.ioc))
      {
         logger.add_attribute("Channel", boost::log::attributes::constant(std::string("http")));
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
            {
               PSIBASE_LOG(logger, error) << "http unix socket is in use";
               listen_fail();
            }
            //socket exists but no one home, go ahead and remove it and continue on
            else if (test_ec == boost::system::errc::connection_refused)
               ::unlink(server.http_config->unix_path.c_str());
            else if (test_ec != boost::system::errc::no_such_file_or_directory)
            {
               PSIBASE_LOG(logger, error)
                   << "unexpected failure when probing existing http unix socket: "
                   << test_ec.message();
               listen_fail();
            }

            start_listen(unix_acceptor, unixs::endpoint(server.http_config->unix_path));
         }

         acceptor_ready = true;
      }

      static void close(std::shared_ptr<listener>&& self, bool)
      {
         boost::asio::dispatch(self->tcp_acceptor.get_executor(),
                               [self]
                               {
                                  if (self->tcp_acceptor.is_open())
                                  {
                                     self->tcp_acceptor.cancel();
                                  }
                               });
         boost::asio::dispatch(self->unix_acceptor.get_executor(),
                               [self]
                               {
                                  if (self->unix_acceptor.is_open())
                                  {
                                     self->unix_acceptor.cancel();
                                  }
                               });
      }

      void listen_fail() { throw std::runtime_error("unable to open listen socket"); }

      template <typename Acceptor, typename Endpoint>
      void start_listen(Acceptor& acceptor, const Endpoint& endpoint)
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
      bool run()
      {
         if (!acceptor_ready)
            return acceptor_ready;
         server.register_connection(shared_from_this());
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
                       if (ec != boost::asio::error::operation_aborted)
                       {
                          fail(logger, ec, "accept");
                       }
                    }
                    else
                    {
                       // Create the http session and run it
                       if constexpr (std::is_same_v<Acceptor, tcp::acceptor>)
                       {
                          boost::system::error_code ec;
                          std::make_shared<tcp_http_session>(self->server, std::move(socket))
                              ->run();
                       }
                       else if constexpr (std::is_same_v<Acceptor, unixs::acceptor>)
                       {
                          boost::system::error_code ec;
                          auto                      rep = socket.remote_endpoint(ec);
                          std::make_shared<unix_http_session>(self->server, std::move(socket))
                              ->run();
                       }
                    }

                    // Accept another connection
                    if (ec != boost::asio::error::operation_aborted)
                    {
                       do_accept(acceptor);
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

   bool server_impl::start()
   {
      auto l = std::make_shared<listener>(*this);
      if (!l->run())
         return false;

      threads.reserve(http_config->num_threads);
      for (unsigned i = 0; i < http_config->num_threads; ++i)
         threads.emplace_back([this, _ = std::unique_lock{thread_count}]() mutable { ioc.run(); });
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
