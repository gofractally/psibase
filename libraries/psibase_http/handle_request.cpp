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
      auto root_host =
          std::ranges::find_if(cfg.hosts, [&](const auto& name) { return host.ends_with(name); });
      if (root_host != cfg.hosts.end() && host.size() > root_host->size() &&
          host[host.size() - root_host->size() - 1] == '.')
      {
         return admin.str() == host.substr(0, host.size() - root_host->size() - 1);
      }
      else
      {
         return false;
      }
   }

   bool is_admin(const http_config& cfg, beast::string_view host)
   {
      host = deport(host);
      return std::visit([&](const auto& admin) { return is_admin(admin, cfg, host); }, cfg.admin);
   }

   // Returns the access mode and an indication of whether the request contains
   // an explicit authorization. The result access mode will not be greater than
   // the argument.
   std::pair<authz::mode_type, bool> get_access_impl(const auto&              req,
                                                     const http_session_base& session,
                                                     const auto&              auth,
                                                     authz::mode_type         mode)
   {
      if constexpr (requires { session.check_access(auth); })
      {
         if (session.check_access(auth))
         {
            return {mode, false};
         }
         else
         {
            return {authz::none, false};
         }
      }
      else
      {
         return {authz::none, false};
      }
   }
   std::pair<authz::mode_type, bool> get_access_impl(const auto&              req,
                                                     const http_session_base& session,
                                                     const authz_any&         auth,
                                                     authz::mode_type         mode)
   {
      return {mode, false};
   }
   std::pair<authz::mode_type, bool> get_access_impl(const auto&              req,
                                                     const http_session_base& session,
                                                     const authz_bearer&      auth,
                                                     authz::mode_type         mode)
   {
      auto             authorization_b = req[bhttp::field::authorization];
      std::string_view authorization{authorization_b.data(), authorization_b.size()};
      std::string_view prefix = "Bearer ";
      if (authorization.starts_with(prefix))
      {
         try
         {
            auto token = decodeJWT<token_data>(auth.key, authorization.substr(prefix.size()));
            if (std::chrono::system_clock::now() >
                std::chrono::system_clock::time_point{std::chrono::seconds(token.exp)})
            {
               return {authz::none, false};
            }
            return {static_cast<authz::mode_type>(mode & authz::mode_from_string(token.mode)),
                    true};
         }
         catch (...)
         {
         }
      }
      return {authz::none, false};
   }

   std::pair<authz::mode_type, bool> get_access(server_state&      server,
                                                auto&              req,
                                                http_session_base& session)
   {
      std::pair<authz::mode_type, bool> result{authz::none, false};
      for (const authz& auth : server.http_config->admin_authz)
      {
         auto [mode, has_auth] = std::visit(
             [&](const auto& a) { return get_access_impl(req, session, a, auth.mode); }, auth.data);
         result.first = static_cast<authz::mode_type>(result.first | mode);
         result.second |= has_auth;
      }
      return result;
   }

   // true: The client is authorized
   // false: The client has a valid authorization, but it is insufficent to access this resource
   // nullopt: The client does not have a valid authorization
   std::optional<bool> check_access(server_state&    server,
                                    auto&            req,
                                    auto&            send,
                                    authz::mode_type required_mode)
   {
      auto [mode, has_auth] = get_access(server, req, send);
      if ((mode & required_mode) == required_mode)
      {
         return true;
      }
      else if (has_auth)
      {
         return false;
      }
      else
      {
         return {};
      }
   }

   std::string mkscope(authz::mode_type mode)
   {
      std::string result;
      if (mode & authz::read)
      {
         result += "monitor";
      }
      else if (mode & authz::write)
      {
         if (!result.empty())
            result.push_back(' ');
         result += "admin";
      }
      return result;
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
   template <typename Body, typename Allocator>
   std::pair<beast::string_view, beast::string_view> parse_request_target(
       const bhttp::request<Body, bhttp::basic_fields<Allocator>>& request)
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

   template <typename F, typename E>
   struct HttpSocket : AutoCloseSocket, std::enable_shared_from_this<HttpSocket<F, E>>
   {
      explicit HttpSocket(std::shared_ptr<http_session_base>&& session, F&& f, E&& err)
          : session(std::move(session)), callback(std::forward<F>(f)), err(std::forward<E>(err))
      {
         this->session->pause_read = true;
         this->once                = true;
      }
      void autoClose(const std::optional<std::string>& message) noexcept override
      {
         sendImpl([message = message.value_or("service did not send a response")](
                      HttpSocket* self) mutable { return self->err(message); });
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
      std::shared_ptr<http_session_base> session;
      F                                  callback;
      E                                  err;
      TransactionTrace                   trace;
      QueryTimes                         queryTimes;
   };

   template <typename F, typename E>
   auto makeHttpSocket(http_session_base& send, F&& f, E&& e)
   {
      return std::make_shared<HttpSocket<std::decay_t<F>, std::decay_t<E>>>(
          send.shared_from_this(), std::forward<F>(f), std::forward<E>(e));
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
      unsigned req_version        = req.version();
      bool     req_keep_alive     = req.keep_alive();
      bool     req_allow_cors     = !req_target.starts_with("/native/");

      const auto set_cors = [&server, req_allow_cors](auto& res)
      {
         if (!server.http_config->allow_origin.empty() && req_allow_cors)
         {
            res.set(bhttp::field::access_control_allow_origin, server.http_config->allow_origin);
            res.set(bhttp::field::access_control_allow_methods, "POST, GET, OPTIONS, HEAD");
            res.set(bhttp::field::access_control_allow_headers, "*");
         }
      };

      const auto set_keep_alive = [&server, req_keep_alive](auto& res)
      {
         bool keep_alive = req_keep_alive && !server.http_config->status.load().shutdown;
         res.keep_alive(keep_alive);
         if (keep_alive)
         {
            if (auto usec = server.http_config->idle_timeout_us.load(); usec >= 0)
            {
               auto sec =
                   std::chrono::duration_cast<std::chrono::seconds>(std::chrono::microseconds{usec})
                       .count();
               res.set(bhttp::field::keep_alive, "timeout=" + std::to_string(sec));
            }
         }
      };

      // Returns a method_not_allowed response
      const auto method_not_allowed = [&server, set_cors, req_version, set_keep_alive](
                                          beast::string_view target, beast::string_view method,
                                          beast::string_view allowed_methods)
      {
         bhttp::response<bhttp::vector_body<char>> res{bhttp::status::method_not_allowed,
                                                       req_version};
         res.set(bhttp::field::server, BOOST_BEAST_VERSION_STRING);
         res.set(bhttp::field::content_type, "text/html");
         res.set(bhttp::field::allow, allowed_methods);
         set_cors(res);
         set_keep_alive(res);
         res.body() = to_vector("The resource '" + std::string(target) +
                                "' does not accept the method " + std::string(method) + ".");
         res.prepare_payload();
         return res;
      };

      // Returns an error response
      const auto error =
          [&server, set_cors, req_version, set_keep_alive](
              bhttp::status status, beast::string_view why, const char* content_type = "text/html")
      {
         bhttp::response<bhttp::vector_body<char>> res{status, req_version};
         res.set(bhttp::field::server, BOOST_BEAST_VERSION_STRING);
         res.set(bhttp::field::content_type, content_type);
         set_cors(res);
         set_keep_alive(res);
         res.body() = std::vector(why.begin(), why.end());
         res.prepare_payload();
         return res;
      };

      const auto not_found = [&error](beast::string_view target)
      {
         return error(bhttp::status::not_found,
                      "The resource '" + std::string(target) + "' was not found.");
      };
      const auto bad_request = [&error](beast::string_view why)
      { return error(bhttp::status::bad_request, why); };

      // Returns an error response with a WWW-Authenticate header
      const auto auth_error = [&server, set_cors, req_version, set_keep_alive](
                                  bhttp::status status, std::string&& www_auth)
      {
         bhttp::response<bhttp::vector_body<char>> res{status, req_version};
         res.set(bhttp::field::server, BOOST_BEAST_VERSION_STRING);
         res.set(bhttp::field::content_type, "text/html");
         res.set(bhttp::field::www_authenticate, std::move(www_auth));
         set_cors(res);
         set_keep_alive(res);
         res.body() = to_vector("Not authorized");
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

      const auto redirect = [req_version, set_cors, set_keep_alive](
                                bhttp::status status, beast::string_view location,
                                beast::string_view msg, const char* content_type = "text/html")
      {
         bhttp::response<bhttp::vector_body<char>> res{status, req_version};
         res.set(bhttp::field::server, BOOST_BEAST_VERSION_STRING);
         res.set(bhttp::field::location, location);
         res.set(bhttp::field::content_type, content_type);
         set_cors(res);
         set_keep_alive(res);
         res.body() = std::vector(msg.begin(), msg.end());
         res.prepare_payload();
         return res;
      };

      // Returns true on success
      // Sends an appropriate error response and returns false on failure
      const auto check_admin_auth = [&server, &req, &send, &auth_error](authz::mode_type mode)
      {
         if (auto result = check_access(server, req, send, mode))
         {
            if (*result)
               return true;
            else
            {
               send(auth_error(bhttp::status::forbidden, "Bearer scope=\"" + mkscope(mode) + "\""));
               return false;
            }
         }
         else
         {
            send(auth_error(bhttp::status::unauthorized, "Bearer scope=\"" + mkscope(mode) + "\""));
            return false;
         }
      };

      // Used for requests that are not subject to CORS such as websockets
      auto forbid_cross_origin = [&req, &req_host, &send, &error]()
      {
         if (auto iter = req.find(bhttp::field::origin); iter != req.end())
         {
            const auto& origin = iter->value();
            if (origin == "null" || remove_scheme(origin) != req_host)
            {
               send(error(bhttp::status::bad_request, "Cross origin request refused"));
               return true;
            }
         }
         return false;
      };

      const auto run_native_handler = [&send, &req](auto&& request_handler, auto&& callback)
      {
         send.pause_read        = true;
         auto post_back_to_http = [callback = static_cast<decltype(callback)>(callback),
                                   session  = send.shared_from_this()](auto&& result) mutable
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
      };

      // The result should be a variant with a std::string representing an error
      const auto& run_native_handler_json = [&](auto&& request_handler)
      {
         run_native_handler(
             request_handler,
             [error, ok](auto&& result)
             {
                return std::visit(
                    [&](auto& body)
                    {
                       if constexpr (!std::is_same_v<std::decay_t<decltype(body)>, std::string>)
                       {
                          std::vector<char>   data;
                          psio::vector_stream stream{data};
                          psio::to_json(body, stream);
                          return ok(std::move(data), "application/json");
                       }
                       else
                       {
                          return error(bhttp::status::internal_server_error, body);
                       }
                    },
                    result);
             });
      };

      // Anything that can serialized as json
      const auto& run_native_handler_json_nofail = [&](auto&& request_handler)
      {
         run_native_handler(request_handler,
                            [ok](auto&& result)
                            {
                               std::vector<char>   data;
                               psio::vector_stream stream{data};
                               psio::to_json(result, stream);
                               return ok(std::move(data), "application/json");
                            });
      };

      // optional<string>
      auto run_native_handler_no_content = [&](auto&& request_handler)
      {
         run_native_handler(request_handler,
                            [ok_no_content, error](auto&& result)
                            {
                               if (result)
                               {
                                  return error(bhttp::status::internal_server_error, *result);
                               }
                               else
                               {
                                  return ok_no_content();
                               }
                            });
      };

      // variant<string, function<vector<char>()>>
      auto run_native_handler_generic = [&](auto& request_handler, const char* content_type)
      {
         run_native_handler(
             request_handler,
             [error, ok, content_type](auto&& result)
             {
                return std::visit(
                    [&](auto& body)
                    {
                       if constexpr (!std::is_same_v<std::decay_t<decltype(body)>, std::string>)
                       {
                          return ok(body(), content_type);
                       }
                       else
                       {
                          return error(bhttp::status::internal_server_error, body);
                       }
                    },
                    result);
             });
      };

      auto run_native_handler_generic_nofail = [&](auto& request_handler, const char* content_type)
      {
         run_native_handler(request_handler, [ok, content_type](auto&& result)
                            { return ok(result(), content_type); });
      };

      try
      {
         std::shared_lock l{server.http_config->mutex};
         if (req_target == "")
         {
            return send(bad_request("Invalid request target"));
         }
         else if (!req_target.starts_with("/native"))
         {
            auto [host, port] = split_port(req_host);

            if (auto iter = server.http_config->services.find(host);
                iter != server.http_config->services.end())
            {
               auto file = iter->second.find(req_target);
               if (file != iter->second.end())
               {
                  if (req.method() == bhttp::verb::options)
                  {
                     return send(ok_no_content());
                  }
                  else if (req.method() != bhttp::verb::get && req.method() != bhttp::verb::head)
                  {
                     return send(method_not_allowed(req.target(), req.method_string(),
                                                    "GET, OPTIONS, HEAD"));
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
               if (server.http_config->hosts.empty())
                  return send(not_found(req.target()));
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
                  return send(redirect(bhttp::status::moved_permanently, location,
                                       "<html><body>"
                                       "This psibase server is hosted at <a href=\"" +
                                           location + "\">" + location + "</a>.</body></html>\n"));
               }
            }

            if (req.method() == bhttp::verb::options)
            {
               return send(ok_no_content());
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
            else
               return send(
                   method_not_allowed(req.target(), req.method_string(), "GET, POST, OPTIONS"));
            data.host        = {host.begin(), host.size()};
            data.rootHost    = root_host;
            data.target      = std::string(req_target);
            data.contentType = (std::string)req[bhttp::field::content_type];
            data.body        = std::move(req.body());

            // Do not use any reconfigurable members of server.http_config after this point
            l.unlock();

            // TODO: time limit
            auto system = server.sharedState->getSystemContext();

            psio::finally f{[&]() { server.sharedState->addSystemContext(std::move(system)); }};
            BlockContext  bc{*system, system->sharedDatabase.getHead(),
                            system->sharedDatabase.createWriter(), true};
            bc.start();
            if (bc.needGenesisAction)
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
               if (pos != server.http_config->services.end())
               {
                  location.append(pos->first);
                  l.unlock();
                  location.append(port.data(), port.size());
                  location.push_back('/');
                  return send(redirect(bhttp::status::found, location,
                                       "<html><body>Node is not connected to any psibase network.  "
                                       "Visit <a href=\"" +
                                           location + "\">" + location +
                                           "</a> for node setup.</body></html>\n"));
               }
               else
               {
                  // No native service to redirect to. Just report an error
                  l.unlock();
                  return send(error(bhttp::status::internal_server_error,
                                    "Node is not connected to any psibase network."));
               }
            }

            SignedTransaction  trx;
            TransactionTrace   trace;
            TransactionContext tc{bc, trx, trace, true, false, true};
            ActionTrace&       atrace        = trace.actionTraces.emplace_back();
            auto               startExecTime = steady_clock::now();

            auto socket = makeHttpSocket(
                send,
                [req_version, set_cors, set_keep_alive](HttpReply&& reply)
                {
                   bhttp::response<bhttp::vector_body<char>> res{
                       bhttp::int_to_status(static_cast<std::uint16_t>(reply.status)), req_version};
                   res.set(bhttp::field::server, BOOST_BEAST_VERSION_STRING);
                   for (auto& h : reply.headers)
                      res.set(h.name, h.value);
                   res.set(bhttp::field::content_type, reply.contentType);
                   set_cors(res);
                   set_keep_alive(res);
                   res.body() = std::move(reply.body);
                   res.prepare_payload();
                   return res;
                },
                [error](const std::string& message)
                { return error(bhttp::status::internal_server_error, message); });
            system->sockets->add(socket, &tc.ownedSockets);

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
         }  // !native
         else if (req_target == "/native/admin/push_boot" && server.http_config->push_boot_async)
         {
            if (!server.http_config->enable_transactions)
               return send(not_found(req.target()));

            if (!is_admin(*server.http_config, req_host))
            {
               return send(not_found(req.target()));
            }
            if (!check_admin_auth(authz::mode_type::write))
            {
               return;
            }

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

            run_native_handler_json(server.http_config->push_boot_async);
         }  // push_boot
         else if (req_target == "/native/p2p" && websocket::is_upgrade(req) &&
                  !boost::type_erasure::is_empty(server.http_config->accept_p2p_websocket) &&
                  server.http_config->enable_p2p)
         {
            if (forbid_cross_origin())
               return;
            // Stop reading HTTP requests
            send.pause_read = true;
            send(websocket_upgrade{}, std::move(req), server.http_config->accept_p2p_websocket);
            return;
         }
         else if (req_target == "/native/admin/status")
         {
            if (!is_admin(*server.http_config, req_host))
            {
               return send(not_found(req.target()));
            }
            if (req.method() == bhttp::verb::get)
            {
               if (!check_admin_auth(authz::mode_type::read))
               {
                  return;
               }
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
               send(ok(std::move(body), "application/json"));
            }
            else
            {
               send(method_not_allowed(req.target(), req.method_string(), "GET"));
            }
         }
         else if (req_target == "/native/admin/shutdown")
         {
            if (!is_admin(*server.http_config, req_host))
            {
               return send(not_found(req.target()));
            }
            if (req.method() != bhttp::verb::post)
            {
               return send(method_not_allowed(req.target(), req.method_string(), "POST"));
            }
            if (!check_admin_auth(authz::mode_type::write))
            {
               return;
            }
            if (req[bhttp::field::content_type] != "application/json")
            {
               return send(error(bhttp::status::unsupported_media_type,
                                 "Content-Type must be application/json\n"));
            }
            server.http_config->shutdown(std::move(req.body()));
            return send(accepted());
         }
         else if (req_target == "/native/admin/perf" && server.http_config->get_perf)
         {
            if (!is_admin(*server.http_config, req_host))
            {
               return send(not_found(req.target()));
            }
            if (req.method() != bhttp::verb::get)
            {
               return send(method_not_allowed(req.target(), req.method_string(), "GET"));
            }
            if (!check_admin_auth(authz::mode_type::read))
            {
               return;
            }
            run_native_handler_generic_nofail(server.http_config->get_perf, "application/json");
         }
         else if (req_target == "/native/admin/metrics" && server.http_config->get_metrics)
         {
            if (!is_admin(*server.http_config, req_host))
            {
               return send(not_found(req.target()));
            }
            if (req.method() != bhttp::verb::get)
            {
               return send(method_not_allowed(req.target(), req.method_string(), "GET"));
            }
            if (!check_admin_auth(authz::mode_type::read))
            {
               return;
            }
            run_native_handler_generic_nofail(
                server.http_config->get_metrics,
                "application/openmetrics-text; version=1.0.0; charset=utf-8");
         }
         else if (req_target == "/native/admin/peers" && server.http_config->get_peers)
         {
            if (!is_admin(*server.http_config, req_host))
            {
               return send(not_found(req.target()));
            }
            if (req.method() != bhttp::verb::get)
            {
               return send(method_not_allowed(req.target(), req.method_string(), "GET"));
            }
            if (!check_admin_auth(authz::mode_type::read))
            {
               return;
            }

            // returns json list of {id:int,endpoint:string}
            run_native_handler_json_nofail(server.http_config->get_peers);
         }
         else if (req_target == "/native/admin/connect" && server.http_config->connect)
         {
            if (!is_admin(*server.http_config, req_host))
            {
               return send(not_found(req.target()));
            }
            if (req.method() != bhttp::verb::post)
            {
               return send(method_not_allowed(req.target(), req.method_string(), "POST"));
            }
            if (!check_admin_auth(authz::mode_type::write))
            {
               return;
            }

            if (req[bhttp::field::content_type] != "application/json")
            {
               send(error(bhttp::status::unsupported_media_type,
                          "Content-Type must be application/json\n"));
               return;
            }

            run_native_handler_no_content(server.http_config->connect);
         }
         else if (req_target == "/native/admin/disconnect" && server.http_config->disconnect)
         {
            if (!is_admin(*server.http_config, req_host))
            {
               return send(not_found(req.target()));
            }
            if (req.method() != bhttp::verb::post)
            {
               return send(method_not_allowed(req.target(), req.method_string(), "POST"));
            }
            if (!check_admin_auth(authz::mode_type::write))
            {
               return;
            }

            if (req[bhttp::field::content_type] != "application/json")
            {
               send(error(bhttp::status::unsupported_media_type,
                          "Content-Type must be application/json\n"));
               return;
            }

            run_native_handler_no_content(server.http_config->disconnect);
         }
         else if (req_target == "/native/admin/log" && websocket::is_upgrade(req))
         {
            if (!is_admin(*server.http_config, req_host))
               return send(not_found(req.target()));
            if (forbid_cross_origin())
               return;
            if (!check_admin_auth(authz::mode_type::read))
            {
               return;
            }
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
            if (!is_admin(*server.http_config, req_host))
            {
               return send(not_found(req.target()));
            }
            if (req.method() == bhttp::verb::get)
            {
               if (!check_admin_auth(authz::mode_type::read_write))
               {
                  return;
               }
               run_native_handler_generic_nofail(server.http_config->get_config,
                                                 "application/json");
            }
            else if (req.method() == bhttp::verb::put)
            {
               if (!check_admin_auth(authz::mode_type::write))
               {
                  return;
               }
               if (req[bhttp::field::content_type] != "application/json")
               {
                  return send(error(bhttp::status::unsupported_media_type,
                                    "Content-Type must be application/json\n"));
               }
               run_native_handler_no_content(server.http_config->set_config);
            }
            else
            {
               send(method_not_allowed(req.target(), req.method_string(), "GET, PUT"));
            }
            return;
         }
         else if (req_target == "/native/admin/keys")
         {
            if (!is_admin(*server.http_config, req_host))
            {
               return send(not_found(req.target()));
            }
            if (req.method() == bhttp::verb::get)
            {
               if (!check_admin_auth(authz::mode_type::read))
               {
                  return;
               }
               run_native_handler_generic_nofail(server.http_config->get_keys, "application/json");
            }
            else if (req.method() == bhttp::verb::post)
            {
               if (!check_admin_auth(authz::mode_type::write))
               {
                  return;
               }
               if (req[bhttp::field::content_type] != "application/json")
               {
                  return send(error(bhttp::status::unsupported_media_type,
                                    "Content-Type must be application/json\n"));
               }

               run_native_handler_generic(server.http_config->new_key, "application/json");
            }
            else
            {
               send(method_not_allowed(req.target(), req.method_string(), "GET, POST"));
            }
            return;
         }
         else if (req_target == "/native/admin/keys/devices")
         {
            if (!is_admin(*server.http_config, req_host))
            {
               return send(not_found(req.target()));
            }
            if (req.method() != bhttp::verb::get)
            {
               send(method_not_allowed(req.target(), req.method_string(), "GET"));
            }
            if (!check_admin_auth(authz::mode_type::read))
            {
               return;
            }
            run_native_handler_generic(server.http_config->get_pkcs11_tokens, "application/json");
         }
         else if (req_target == "/native/admin/keys/unlock")
         {
            if (!is_admin(*server.http_config, req_host))
            {
               return send(not_found(req.target()));
            }
            if (req.method() != bhttp::verb::post)
            {
               send(method_not_allowed(req.target(), req.method_string(), "POST"));
            }
            if (!check_admin_auth(authz::mode_type::write))
            {
               return;
            }
            if (req[bhttp::field::content_type] != "application/json")
            {
               return send(error(bhttp::status::unsupported_media_type,
                                 "Content-Type must be application/json\n"));
            }
            run_native_handler_no_content(server.http_config->unlock_keyring);
         }
         else if (req_target == "/native/admin/keys/lock")
         {
            if (!is_admin(*server.http_config, req_host))
            {
               return send(not_found(req.target()));
            }
            if (req.method() != bhttp::verb::post)
            {
               send(method_not_allowed(req.target(), req.method_string(), "POST"));
            }
            if (!check_admin_auth(authz::mode_type::write))
            {
               return;
            }
            if (req[bhttp::field::content_type] != "application/json")
            {
               return send(error(bhttp::status::unsupported_media_type,
                                 "Content-Type must be application/json\n"));
            }
            run_native_handler_no_content(server.http_config->lock_keyring);
         }
         else if (req_target == "/native/admin/login")
         {
            if (!is_admin(*server.http_config, req_host))
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

            const token_key* key = nullptr;
            for (const auto& auth : server.http_config->admin_authz)
            {
               if (const auto* bearer = std::get_if<authz_bearer>(&auth.data))
               {
                  key = &bearer->key;
               }
            }
            if (!key)
            {
               return send(error(bhttp::status::internal_server_error,
                                 "Login requires bearer tokens to be enabled"));
            }
            auto [mode, has_auth] = get_access(server, req, send);

            auto input = std::move(req.body());
            input.push_back('\0');
            input.push_back('\0');
            input.push_back('\0');
            psio::json_token_stream stream{input.data()};
            auto                    params = psio::from_json<token_data>(stream);
            if (!params.exp)
            {
               params.exp = std::chrono::time_point_cast<std::chrono::seconds>(
                                std::chrono::system_clock::now() + std::chrono::hours(1))
                                .time_since_epoch()
                                .count();
            }
            if (params.mode.empty())
            {
               if (mode == authz::read)
               {
                  params.mode = "r";
               }
               else
               {
                  params.mode = "rw";
               }
            }
            auto required_mode = authz::mode_from_string(params.mode);
            if ((required_mode & mode) != required_mode)
            {
               if (has_auth)
                  return send(auth_error(bhttp::status::forbidden,
                                         "Bearer scope=\"" + mkscope(required_mode) + "\""));
               else
                  return send(auth_error(bhttp::status::unauthorized,
                                         "Bearer scope=\"" + mkscope(required_mode) + "\""));
            }
            auto token = encodeJWT(*key, params);

            std::vector<char>   data;
            psio::vector_stream out{data};
            psio::to_json(
                token_response{.accessToken = token, .exp = params.exp, .mode = params.mode}, out);
            return send(ok(std::move(data), "application/json"));
         }
         else
         {
            return send(not_found(req.target()));
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

}  // namespace psibase::http
