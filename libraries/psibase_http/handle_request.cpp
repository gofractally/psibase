#include "http_session_base.hpp"
#include "websocket_log_session.hpp"

#include <boost/beast/version.hpp>
#include <boost/beast/websocket.hpp>
#include <boost/type_erasure/is_empty.hpp>
#include <fstream>
#include <psibase/BlockContext.hpp>
#include <psibase/Rpc.hpp>
#include <psibase/Socket.hpp>
#include <psibase/TransactionContext.hpp>
#include <psibase/serviceEntry.hpp>
#include <psio/finally.hpp>
#include <psio/to_json.hpp>
#include <unordered_set>

namespace beast     = boost::beast;
namespace bhttp     = beast::http;
namespace websocket = beast::websocket;
using steady_clock  = std::chrono::steady_clock;

namespace psibase::http
{

   // Private HTTP headers that are not forwarded to wasm
   const std::unordered_set<std::string> private_headers = {"proxy-authorization"};

   bool is_private_header(const std::string& name)
   {
      std::string lower_name = name;
      std::transform(lower_name.begin(), lower_name.end(), lower_name.begin(), ::tolower);
      return private_headers.find(lower_name) != private_headers.end();
   }

   template <typename T>
   constexpr std::size_t function_arg_count = 0;

   template <typename R, typename... T>
   constexpr std::size_t function_arg_count<std::function<R(T...)>> = sizeof...(T);

   beast::string_view remove_scheme(beast::string_view origin)
   {
      auto pos = origin.find("://");
      if (pos != beast::string_view::npos)
      {
         return origin.substr(pos + 3);
      }
      return origin;
   }

   std::pair<beast::string_view, beast::string_view> split_port(beast::string_view host)
   {
      if (auto pos = host.rfind(':'); pos != std::string::npos)
      {
         if (host.find(']', pos) == std::string::npos)
         {
            return {host.substr(0, pos), host.substr(pos)};
         }
      }
      return {host, {}};
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

   std::pair<beast::string_view, beast::string_view> parse_uri(beast::string_view uri)
   {
      if (uri.starts_with("http://"))
      {
         uri = uri.substr(7);
      }
      else if (uri.starts_with("https://"))
      {
         uri = uri.substr(8);
      }
      else
      {
         return {};
      }
      auto pos         = uri.find('/');
      auto authority   = uri.substr(0, pos);
      auto path        = pos == std::string::npos ? "/" : uri.substr(pos);
      auto enduserinfo = authority.find('@');
      auto host = enduserinfo == std::string::npos ? authority : authority.substr(enduserinfo + 1);
      return {host, path};
   }

   // Returns the host and path for the request. See RFC 9112 § 3.2 and 3.3
   std::pair<beast::string_view, beast::string_view> parse_request_target(
       const http_session_base::request_type& request)
   {
      auto target = request.target();
      if (target.starts_with('/') || target == "*")
      {
         return {request[bhttp::field::host], target};
      }
      else
      {
         // We are not a proxy, so we don't need to support authority-form
         return parse_uri(target);
      }
   }

   std::vector<char> to_vector(std::string_view s)
   {
      return std::vector(s.begin(), s.end());
   }

   struct QueryTimes
   {
      std::chrono::microseconds             packTime;
      std::chrono::microseconds             serviceLoadTime;
      std::chrono::microseconds             databaseTime;
      std::chrono::microseconds             wasmExecTime;
      std::chrono::steady_clock::time_point startTime;
   };

   struct HttpReplyBuilder
   {
      const http_config& config;
      unsigned           req_version;
      bool               req_keep_alive;

      HttpReplyBuilder(server_state& server, const http_session_base::request_type& req)
          : config(*server.http_config),
            req_version(req.version()),
            req_keep_alive(req.keep_alive())
      {
      }

      void setCors(auto& res, bool allow_cors) const
      {
         if (allow_cors)
         {
            res.set(bhttp::field::access_control_allow_origin, "*");
            res.set(bhttp::field::access_control_allow_methods, "POST, GET, OPTIONS, HEAD");
            res.set(bhttp::field::access_control_allow_headers, "*");
         }
      }

      void setKeepAlive(auto& res) const
      {
         bool keep_alive = req_keep_alive && !config.status.load().shutdown;
         res.keep_alive(keep_alive);
         if (keep_alive)
         {
            if (auto usec = config.idle_timeout_us.load(); usec >= 0)
            {
               auto sec =
                   std::chrono::duration_cast<std::chrono::seconds>(std::chrono::microseconds{usec})
                       .count();
               res.set(bhttp::field::keep_alive, "timeout=" + std::to_string(sec));
            }
         }
      }

      // Returns a method_not_allowed response
      auto methodNotAllowed(beast::string_view target,
                            beast::string_view method,
                            beast::string_view allowed_methods,
                            bool               allow_cors = false) const
      {
         bhttp::response<bhttp::vector_body<char>> res{bhttp::status::method_not_allowed,
                                                       req_version};
         res.set(bhttp::field::server, BOOST_BEAST_VERSION_STRING);
         res.set(bhttp::field::content_type, "text/html");
         res.set(bhttp::field::allow, allowed_methods);
         setCors(res, allow_cors);
         setKeepAlive(res);
         res.body() = to_vector("The resource '" + std::string(target) +
                                "' does not accept the method " + std::string(method) + ".");
         res.prepare_payload();
         return res;
      }

      // Returns an error response
      auto error(bhttp::status      status,
                 beast::string_view why,
                 bool               allow_cors   = false,
                 const char*        content_type = "text/html") const
      {
         bhttp::response<bhttp::vector_body<char>> res{status, req_version};
         res.set(bhttp::field::server, BOOST_BEAST_VERSION_STRING);
         res.set(bhttp::field::content_type, content_type);
         setCors(res, allow_cors);
         setKeepAlive(res);
         res.body() = std::vector(why.begin(), why.end());
         res.prepare_payload();
         return res;
      }

      auto notFound(beast::string_view target, bool allow_cors = false) const
      {
         return error(bhttp::status::not_found,
                      "The resource '" + std::string(target) + "' was not found.", allow_cors);
      }
      auto badRequest(beast::string_view why) const
      {
         return error(bhttp::status::bad_request, why);
      };

      // Returns an error response with a WWW-Authenticate header
      auto authError(bhttp::status status, std::string&& www_auth) const
      {
         bhttp::response<bhttp::vector_body<char>> res{status, req_version};
         res.set(bhttp::field::server, BOOST_BEAST_VERSION_STRING);
         res.set(bhttp::field::content_type, "text/html");
         res.set(bhttp::field::www_authenticate, std::move(www_auth));
         setKeepAlive(res);
         res.body() = to_vector("Not authorized");
         res.prepare_payload();
         return res;
      }

      auto ok(std::vector<char>              reply,
              const char*                    content_type,
              const std::vector<HttpHeader>* headers    = nullptr,
              bool                           allow_cors = false) const
      {
         bhttp::response<bhttp::vector_body<char>> res{bhttp::status::ok, req_version};
         res.set(bhttp::field::server, BOOST_BEAST_VERSION_STRING);
         if (headers)
            for (auto& h : *headers)
               res.set(h.name, h.value);
         res.set(bhttp::field::content_type, content_type);
         setCors(res, allow_cors);
         setKeepAlive(res);
         res.body() = std::move(reply);
         res.prepare_payload();
         return res;
      }

      auto okNoContent(bool allow_cors = false) const
      {
         bhttp::response<bhttp::vector_body<char>> res{bhttp::status::ok, req_version};
         res.set(bhttp::field::server, BOOST_BEAST_VERSION_STRING);
         setCors(res, allow_cors);
         setKeepAlive(res);
         res.prepare_payload();
         return res;
      }

      auto accepted() const
      {
         bhttp::response<bhttp::vector_body<char>> res{bhttp::status::accepted, req_version};
         res.set(bhttp::field::server, BOOST_BEAST_VERSION_STRING);
         setKeepAlive(res);
         res.prepare_payload();
         return res;
      }

      auto redirect(bhttp::status      status,
                    beast::string_view location,
                    beast::string_view msg,
                    bool               allow_cors   = false,
                    const char*        content_type = "text/html") const
      {
         bhttp::response<bhttp::vector_body<char>> res{status, req_version};
         res.set(bhttp::field::server, BOOST_BEAST_VERSION_STRING);
         res.set(bhttp::field::location, location);
         res.set(bhttp::field::content_type, content_type);
         setCors(res, allow_cors);
         setKeepAlive(res);
         res.body() = std::vector(msg.begin(), msg.end());
         res.prepare_payload();
         return res;
      }
   };

   template <typename F, typename E>
   struct HttpSocket : AutoCloseSocket, std::enable_shared_from_this<HttpSocket<F, E>>
   {
      explicit HttpSocket(http_session_base::request_type&&    req,
                          std::shared_ptr<http_session_base>&& session,
                          F&&                                  f,
                          E&&                                  err)
          : req(std::move(req)),
            session(std::move(session)),
            callback(std::forward<F>(f)),
            err(std::forward<E>(err))
      {
         this->session->pause_read = true;
         this->once                = true;
      }
      void autoCloseImpl(std::string message)
      {
         sendImpl([message = std::move(message)](HttpSocket* self) mutable
                  { return self->err(message); });
      }
      void autoClose(const std::optional<std::string>& message) noexcept override
      {
         if (!message && parse_request_target(req).second.starts_with("/native/"))
         {
            session->post(
                [self = this->shared_from_this()]
                {
                   try
                   {
                      self->handleNativeRequest();
                      if (self->session && self->session->can_read())
                         self->session->do_read();
                   }
                   catch (std::exception& e)
                   {
                      self->autoCloseImpl("exception: " + std::string(e.what()));
                   }
                   catch (...)
                   {
                      self->autoCloseImpl("query failed: unknown exception\n");
                   }
                });
         }
         else
         {
            autoCloseImpl(message.value_or("service did not send a response"));
         }
      }
      void send(std::span<const char> data) override
      {
         sendImpl([result = psio::from_frac<HttpReply>(data)](HttpSocket* self) mutable
                  { return self->callback(std::move(result)); });
      }
      void sendImpl(auto make_reply)
      {
         auto self = this->shared_from_this();
         session->post(
             [self = std::move(self), make_reply = std::move(make_reply)]() mutable
             {
                auto session = std::move(self->session);
                if (!session)
                   return;
                auto& trace         = self->trace;
                auto& queryTimes    = self->queryTimes;
                session->pause_read = false;
                {
                   auto  endTime = steady_clock::now();
                   auto& logger  = session->logger;
                   BOOST_LOG_SCOPED_LOGGER_TAG(logger, "Trace", std::move(trace));

                   // TODO: consider bundling into a single attribute
                   BOOST_LOG_SCOPED_LOGGER_TAG(logger, "PackTime", queryTimes.packTime);
                   BOOST_LOG_SCOPED_LOGGER_TAG(logger, "ServiceLoadTime",
                                               queryTimes.serviceLoadTime);
                   BOOST_LOG_SCOPED_LOGGER_TAG(logger, "DatabaseTime", queryTimes.databaseTime);
                   BOOST_LOG_SCOPED_LOGGER_TAG(logger, "WasmExecTime", queryTimes.wasmExecTime);
                   BOOST_LOG_SCOPED_LOGGER_TAG(
                       logger, "ResponseTime",
                       std::chrono::duration_cast<std::chrono::microseconds>(endTime -
                                                                             queryTimes.startTime));
                   (*session)(make_reply(self.get()));
                }
                if (session->can_read())
                   session->do_read();
             });
      }
      virtual SocketInfo info() const override
      {
         return HttpSocketInfo{.endpoint = session->remote_endpoint()};
      }

      void runNativeHandler(auto&& request_handler, auto&& callback)
      {
         session->pause_read    = true;
         auto post_back_to_http = [callback = static_cast<decltype(callback)>(callback),
                                   session  = std::move(session)](auto&& result) mutable
         {
            auto* p = session.get();
            p->post(
                [callback = std::move(callback), session = std::move(session),
                 result = static_cast<decltype(result)>(result)]() mutable
                {
                   session->pause_read = false;
                   (*session)(callback(std::move(result)));
                   if (session->can_read())
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
      }

      // The result should be a variant with a std::string representing an error
      void runNativeHandlerJson(auto&& request_handler)
      {
         runNativeHandler(
             request_handler,
             [builder = HttpReplyBuilder{session->server, req}](auto&& result)
             {
                return std::visit(
                    [&](auto& body)
                    {
                       if constexpr (!std::is_same_v<std::decay_t<decltype(body)>, std::string>)
                       {
                          std::vector<char>   data;
                          psio::vector_stream stream{data};
                          psio::to_json(body, stream);
                          return builder.ok(std::move(data), "application/json");
                       }
                       else
                       {
                          return builder.error(bhttp::status::internal_server_error, body);
                       }
                    },
                    result);
             });
      }

      // Anything that can serialized as json
      void runNativeHandlerJsonNoFail(auto&& request_handler)
      {
         runNativeHandler(request_handler,
                          [builder = HttpReplyBuilder{session->server, req}](auto&& result)
                          {
                             std::vector<char>   data;
                             psio::vector_stream stream{data};
                             psio::to_json(result, stream);
                             return builder.ok(std::move(data), "application/json");
                          });
      }

      // optional<string>
      void runNativeHandlerNoContent(auto&& request_handler)
      {
         runNativeHandler(request_handler,
                          [builder = HttpReplyBuilder{session->server, req}](auto&& result)
                          {
                             if (result)
                             {
                                return builder.error(bhttp::status::internal_server_error, *result);
                             }
                             else
                             {
                                return builder.okNoContent();
                             }
                          });
      }

      // variant<string, function<vector<char>()>>
      void runNativeHandlerGeneric(auto& request_handler, const char* content_type)
      {
         runNativeHandler(
             request_handler,
             [builder = HttpReplyBuilder{session->server, req}, content_type](auto&& result)
             {
                return std::visit(
                    [&](auto& body)
                    {
                       if constexpr (!std::is_same_v<std::decay_t<decltype(body)>, std::string>)
                       {
                          return builder.ok(body(), content_type);
                       }
                       else
                       {
                          return builder.error(bhttp::status::internal_server_error, body);
                       }
                    },
                    result);
             });
      }

      void runNativeHandlerGenericNoFail(auto& request_handler, const char* content_type)
      {
         runNativeHandler(request_handler, [builder = HttpReplyBuilder{session->server, req},
                                            content_type](auto&& result)
                          { return builder.ok(result(), content_type); });
      };

      void handleNativeRequest()
      {
         server_state&      server = session->server;
         http_session_base& send   = *session;
         HttpReplyBuilder   builder{server, req};
         auto [req_host, req_target] = parse_request_target(req);

         session->pause_read = false;

         // Used for requests that are not subject to CORS such as websockets
         auto forbidCrossOrigin = [this, &req_host, &send, &builder]()
         {
            if (auto iter = req.find(bhttp::field::origin); iter != req.end())
            {
               const auto& origin = iter->value();
               if (origin == "null" || remove_scheme(origin) != req_host)
               {
                  send(builder.error(bhttp::status::bad_request, "Cross origin request refused"));
                  return true;
               }
            }
            return false;
         };

         if (req_target == "/native/admin/push_boot" && server.http_config->push_boot_async)
         {
            if (!server.http_config->enable_transactions)
               return send(builder.notFound(req.target()));

            if (req.method() != bhttp::verb::post)
            {
               return send(builder.methodNotAllowed(req.target(), req.method_string(), "POST"));
            }

            if (auto content_type = req.find(bhttp::field::content_type); content_type != req.end())
            {
               if (content_type->value() != "application/octet-stream")
               {
                  return send(builder.error(bhttp::status::unsupported_media_type,
                                            "Content-Type must be application/octet-stream\n"));
               }
            }

            if (forbidCrossOrigin())
            {
               return;
            }

            runNativeHandlerJson(server.http_config->push_boot_async);
         }  // push_boot
         else if (req_target == "/native/p2p" && websocket::is_upgrade(req) &&
                  !boost::type_erasure::is_empty(server.http_config->accept_p2p_websocket) &&
                  server.http_config->enable_p2p)
         {
            if (forbidCrossOrigin())
               return;
            // Stop reading HTTP requests
            send.pause_read = true;
            send(websocket_upgrade{}, std::move(req), server.http_config->accept_p2p_websocket);
            return;
         }
         else if (req_target == "/native/admin/status")
         {
            if (req.method() == bhttp::verb::get)
            {
               auto status = server.http_config->status.load();
               if (status.needgenesis)
               {
                  if (!server.sharedState->needGenesis())
                  {
                     status = atomic_set_field(server.http_config->status,
                                               [](auto& tmp) { tmp.needgenesis = false; });
                  }
               }
               std::vector<char>   body;
               psio::vector_stream stream{body};
               to_json(status, stream);
               send(builder.ok(std::move(body), "application/json"));
            }
            else
            {
               send(builder.methodNotAllowed(req.target(), req.method_string(), "GET"));
            }
         }
         else if (req_target == "/native/admin/shutdown")
         {
            if (req.method() != bhttp::verb::post)
            {
               return send(builder.methodNotAllowed(req.target(), req.method_string(), "POST"));
            }
            if (req[bhttp::field::content_type] != "application/json")
            {
               return send(builder.error(bhttp::status::unsupported_media_type,
                                         "Content-Type must be application/json\n"));
            }
            server.http_config->shutdown(std::move(req.body()));
            return send(builder.accepted());
         }
         else if (req_target == "/native/admin/perf" && server.http_config->get_perf)
         {
            if (req.method() != bhttp::verb::get)
            {
               return send(builder.methodNotAllowed(req.target(), req.method_string(), "GET"));
            }
            runNativeHandlerGenericNoFail(server.http_config->get_perf, "application/json");
         }
         else if (req_target == "/native/admin/metrics" && server.http_config->get_metrics)
         {
            if (req.method() != bhttp::verb::get)
            {
               return send(builder.methodNotAllowed(req.target(), req.method_string(), "GET"));
            }
            runNativeHandlerGenericNoFail(
                server.http_config->get_metrics,
                "application/openmetrics-text; version=1.0.0; charset=utf-8");
         }
         else if (req_target == "/native/admin/peers" && server.http_config->get_peers)
         {
            if (req.method() != bhttp::verb::get)
            {
               return send(builder.methodNotAllowed(req.target(), req.method_string(), "GET"));
            }

            // returns json list of {id:int,endpoint:string}
            runNativeHandlerJsonNoFail(server.http_config->get_peers);
         }
         else if (req_target == "/native/admin/connect" && server.http_config->connect)
         {
            if (req.method() != bhttp::verb::post)
            {
               return send(builder.methodNotAllowed(req.target(), req.method_string(), "POST"));
            }

            if (req[bhttp::field::content_type] != "application/json")
            {
               send(builder.error(bhttp::status::unsupported_media_type,
                                  "Content-Type must be application/json\n"));
               return;
            }

            runNativeHandlerNoContent(server.http_config->connect);
         }
         else if (req_target == "/native/admin/disconnect" && server.http_config->disconnect)
         {
            if (req.method() != bhttp::verb::post)
            {
               return send(builder.methodNotAllowed(req.target(), req.method_string(), "POST"));
            }

            if (req[bhttp::field::content_type] != "application/json")
            {
               send(builder.error(bhttp::status::unsupported_media_type,
                                  "Content-Type must be application/json\n"));
               return;
            }

            runNativeHandlerNoContent(server.http_config->disconnect);
         }
         else if (req_target == "/native/admin/log" && websocket::is_upgrade(req))
         {
            if (forbidCrossOrigin())
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
         else if (req_target == "/native/admin/config")
         {
            if (req.method() == bhttp::verb::get)
            {
               runNativeHandlerGenericNoFail(server.http_config->get_config, "application/json");
            }
            else if (req.method() == bhttp::verb::put)
            {
               if (req[bhttp::field::content_type] != "application/json")
               {
                  return send(builder.error(bhttp::status::unsupported_media_type,
                                            "Content-Type must be application/json\n"));
               }
               runNativeHandlerNoContent(server.http_config->set_config);
            }
            else
            {
               send(builder.methodNotAllowed(req.target(), req.method_string(), "GET, PUT"));
            }
            return;
         }
         else if (req_target == "/native/admin/keys")
         {
            if (req.method() == bhttp::verb::get)
            {
               runNativeHandlerGenericNoFail(server.http_config->get_keys, "application/json");
            }
            else if (req.method() == bhttp::verb::post)
            {
               if (req[bhttp::field::content_type] != "application/json")
               {
                  return send(builder.error(bhttp::status::unsupported_media_type,
                                            "Content-Type must be application/json\n"));
               }

               runNativeHandlerGeneric(server.http_config->new_key, "application/json");
            }
            else
            {
               send(builder.methodNotAllowed(req.target(), req.method_string(), "GET, POST"));
            }
            return;
         }
         else if (req_target == "/native/admin/keys/devices")
         {
            if (req.method() != bhttp::verb::get)
            {
               send(builder.methodNotAllowed(req.target(), req.method_string(), "GET"));
            }
            runNativeHandlerGeneric(server.http_config->get_pkcs11_tokens, "application/json");
         }
         else if (req_target == "/native/admin/keys/unlock")
         {
            if (req.method() != bhttp::verb::post)
            {
               send(builder.methodNotAllowed(req.target(), req.method_string(), "POST"));
            }
            if (req[bhttp::field::content_type] != "application/json")
            {
               return send(builder.error(bhttp::status::unsupported_media_type,
                                         "Content-Type must be application/json\n"));
            }
            runNativeHandlerNoContent(server.http_config->unlock_keyring);
         }
         else if (req_target == "/native/admin/keys/lock")
         {
            if (req.method() != bhttp::verb::post)
            {
               send(builder.methodNotAllowed(req.target(), req.method_string(), "POST"));
            }
            if (req[bhttp::field::content_type] != "application/json")
            {
               return send(builder.error(bhttp::status::unsupported_media_type,
                                         "Content-Type must be application/json\n"));
            }
            runNativeHandlerNoContent(server.http_config->lock_keyring);
         }
         else
         {
            return send(builder.notFound(req.target()));
         }
      }

      http_session_base::request_type    req;
      std::shared_ptr<http_session_base> session;
      F                                  callback;
      E                                  err;
      TransactionTrace                   trace;
      QueryTimes                         queryTimes;
   };

   template <typename F, typename E>
   auto makeHttpSocket(http_session_base::request_type&& req, http_session_base& send, F&& f, E&& e)
   {
      return std::make_shared<HttpSocket<std::decay_t<F>, std::decay_t<E>>>(
          std::move(req), send.shared_from_this(), std::forward<F>(f), std::forward<E>(e));
   }

   // This function produces an HTTP response for the given
   // request. The type of the response object depends on the
   // contents of the request, so the interface requires the
   // caller to pass a generic lambda for receiving the response.
   void handle_request(server_state&                     server,
                       http_session_base::request_type&& req,
                       http_session_base&                send)
   {
      auto [req_host, req_target] = parse_request_target(req);
      HttpReplyBuilder builder{server, req};

      try
      {
         std::shared_lock l{server.http_config->mutex};
         if (req_target == "")
         {
            return send(builder.badRequest("Invalid request target"));
         }
         else
         {
            auto [host, port] = split_port(req_host);
            auto service      = AccountNumber{};

            if (auto iter = server.http_config->services.find(host);
                iter != server.http_config->services.end())
            {
               auto file = iter->second.find(req_target);
               if (file != iter->second.end())
               {
                  if (req.method() == bhttp::verb::options)
                  {
                     return send(builder.okNoContent(true));
                  }
                  else if (req.method() != bhttp::verb::get && req.method() != bhttp::verb::head)
                  {
                     return send(builder.methodNotAllowed(req.target(), req.method_string(),
                                                          "GET, OPTIONS, HEAD", true));
                  }

                  std::vector<char> contents;
                  // read file
                  auto          size = std::filesystem::file_size(file->second.path);
                  std::ifstream in(file->second.path, std::ios_base::binary);
                  l.unlock();
                  contents.resize(size);
                  in.read(contents.data(), contents.size());
                  return send(builder.ok(std::move(contents), file->second.content_type.c_str(),
                                         nullptr, true));
               }
               else
               {
                  if (auto pos = host.find('.'); pos != std::string::npos)
                  {
                     service = AccountNumber{host.substr(0, pos)};
                  }
                  if (service == AccountNumber{})
                  {
                     return send(builder.notFound(req.target(), true));
                  }
               }
            }

            std::string_view root_host;
            for (const auto& name : server.http_config->hosts)
            {
               if (host.ends_with(name) &&
                   (host.size() == name.size() || host[host.size() - name.size() - 1] == '.'))
               {
                  if (name.size() > root_host.size())
                  {
                     root_host = name;
                  }
               }
            }
            if (root_host.empty())
            {
               if (req_target.starts_with("/native/"))
               {
                  if (server.http_config->hosts.empty())
                     root_host = server.http_config->hosts.front();
               }
               else if (server.http_config->hosts.empty())
                  return send(builder.notFound(req.target(), true));
               else
               {
                  std::string location;
                  if (send.is_secure())
                     location += "https://";
                  else
                     location += "http://";
                  // Ideally, we want to choose a hostname that the client will
                  // resolve to the same address that was used for this connection.
                  // Unfortunately, it isn't really possible in the general case
                  // because we don't have access to the client's DNS.
                  location += server.http_config->hosts.front();
                  location.append(port.data(), port.size());
                  location.append(req_target.data(), req_target.size());
                  return send(builder.redirect(bhttp::status::moved_permanently, location,
                                               "<html><body>"
                                               "This psibase server is hosted at <a href=\"" +
                                                   location + "\">" + location +
                                                   "</a>.</body></html>\n",
                                               true));
               }
            }

            auto        startTime = steady_clock::now();
            HttpRequest data;
            for (auto iter = req.begin(); iter != req.end(); ++iter)
            {
               auto header =
                   HttpHeader{std::string(iter->name_string()), std::string(iter->value())};

               if (!is_private_header(header.name))
               {
                  data.headers.emplace_back(std::move(header));
               }
            }

            if (req.method() == bhttp::verb::get)
               data.method = "GET";
            else if (req.method() == bhttp::verb::post)
               data.method = "POST";
            else if (req.method() == bhttp::verb::head)
               data.method = "HEAD";
            else if (req.method() == bhttp::verb::put)
               data.method = "PUT";
            else if (req.method() == bhttp::verb::delete_)
               data.method = "DELETE";
            else if (req.method() == bhttp::verb::options)
               data.method = "OPTIONS";
            else
               return send(builder.methodNotAllowed(req.target(), req.method_string(),
                                                    "GET, POST, OPTIONS", true));
            data.host        = {host.begin(), host.size()};
            data.rootHost    = root_host;
            data.target      = std::string(req_target);
            data.contentType = (std::string)req[bhttp::field::content_type];
            data.body        = req.body();

            // Do not use any reconfigurable members of server.http_config after this point
            l.unlock();

            // TODO: time limit
            auto system = server.sharedState->getSystemContext();

            psio::finally f{[&]() { server.sharedState->addSystemContext(std::move(system)); }};
            BlockContext  bc{*system, system->sharedDatabase.getHead(),
                            system->sharedDatabase.createWriter(), true};
            bc.start();
            if (service == AccountNumber{} && bc.needGenesisAction &&
                !req_target.starts_with("/native/"))
            {
               std::string location;
               if (send.is_secure())
                  location += "https://";
               else
                  location += "http://";
               l.lock();
               auto suffix = '.' + data.rootHost;
               auto pos =
                   std::ranges::find_if(server.http_config->services, [&suffix](const auto& entry)
                                        { return entry.first.ends_with(suffix); });
               if ((req.method() == bhttp::verb::get || req.method() == bhttp::verb::head) &&
                   pos != server.http_config->services.end())
               {
                  location.append(pos->first);
                  l.unlock();
                  location.append(port.data(), port.size());
                  location.push_back('/');
                  return send(builder.redirect(
                      bhttp::status::found, location,
                      "<html><body>Node is not connected to any psibase network.  "
                      "Visit <a href=\"" +
                          location + "\">" + location + "</a> for node setup.</body></html>\n",
                      true));
               }
               else
               {
                  // No native service to redirect to. Just report an error
                  l.unlock();
                  return send(builder.error(bhttp::status::internal_server_error,
                                            "Node is not connected to any psibase network.", true));
               }
            }

            SignedTransaction  trx;
            TransactionTrace   trace;
            TransactionContext tc{bc, trx, trace, DbMode::rpc()};
            ActionTrace&       atrace        = trace.actionTraces.emplace_back();
            auto               startExecTime = steady_clock::now();

            auto socket = makeHttpSocket(
                std::move(req), send,
                [builder](HttpReply&& reply)
                {
                   bhttp::response<bhttp::vector_body<char>> res{
                       bhttp::int_to_status(static_cast<std::uint16_t>(reply.status)),
                       builder.req_version};
                   res.set(bhttp::field::server, BOOST_BEAST_VERSION_STRING);
                   for (auto& h : reply.headers)
                      res.set(h.name, h.value);
                   res.set(bhttp::field::content_type, reply.contentType);
                   builder.setKeepAlive(res);
                   res.body() = std::move(reply.body);
                   res.prepare_payload();
                   return res;
                },
                [builder](const std::string& message)
                { return builder.error(bhttp::status::internal_server_error, message); });
            system->sockets->add(*bc.writer, socket, &tc.ownedSockets);

            auto setStatus = psio::finally(
                [&]
                {
                   auto endExecTime = steady_clock::now();

                   socket->trace = std::move(trace);

                   socket->queryTimes.packTime =
                       std::chrono::duration_cast<std::chrono::microseconds>(startExecTime -
                                                                             startTime);
                   socket->queryTimes.serviceLoadTime =
                       std::chrono::duration_cast<std::chrono::microseconds>(
                           endExecTime - startExecTime - tc.getBillableTime());
                   socket->queryTimes.databaseTime =
                       std::chrono::duration_cast<std::chrono::microseconds>(tc.databaseTime);
                   socket->queryTimes.wasmExecTime =
                       std::chrono::duration_cast<std::chrono::microseconds>(tc.getBillableTime() -
                                                                             tc.databaseTime);
                   socket->queryTimes.startTime = startTime;
                });

            try
            {
               Action action{
                   .sender  = AccountNumber(),
                   .service = proxyServiceNum,
                   .rawData = psio::convert_to_frac(std::tuple(socket->id, std::move(data))),
               };
               tc.execServe(action, atrace);
            }
            catch (...)
            {
               // An error will be sent by the transaction context, if needed
            }
            if (!tc.ownedSockets.owns(*system->sockets, *socket))
            {
               trace.error  = atrace.error;
               auto  error  = trace.error;
               auto& logger = send.logger;
               BOOST_LOG_SCOPED_LOGGER_TAG(logger, "Trace", std::move(trace));
               if (error)
                  PSIBASE_LOG(logger, warning)
                      << proxyServiceNum.str() << "::serve failed: " << *error;
               else
                  PSIBASE_LOG(logger, info) << proxyServiceNum.str() << "::serve succeeded";
            }
         }
      }
      catch (const std::exception& e)
      {
         return send(builder.error(bhttp::status::internal_server_error,
                                   "exception: " + std::string(e.what())));
      }
      catch (...)
      {
         // TODO: elog("query failed: unknown exception");
         return send(builder.error(bhttp::status::internal_server_error,
                                   "query failed: unknown exception\n"));
      }
   }  // handle_request

}  // namespace psibase::http
