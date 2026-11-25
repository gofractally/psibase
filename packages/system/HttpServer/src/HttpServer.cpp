#include <psibase/HttpHeaders.hpp>
#include <psibase/Rpc.hpp>
#include <psibase/api.hpp>
#include <psibase/dispatch.hpp>
#include <psibase/psibase.hpp>
#include <psibase/webServices.hpp>
#include <psio/pssz.hpp>
#include <psio/pssz_view.hpp>
#include <services/local/XHttp.hpp>
#include <services/system/HttpServer.hpp>
#include <services/system/HttpServerRequest.hpp>
#include <services/system/RTransact.hpp>

static constexpr bool enable_print = false;

using namespace psibase;
using namespace LocalService;

namespace SystemService
{
   namespace
   {
      bool isSubdomain(const psibase::HttpRequest& req, std::string_view rootHost)
      {
         return req.host.size() > rootHost.size() + 1  //
                && req.host.ends_with(rootHost)        //
                && req.host[req.host.size() - rootHost.size() - 1] == '.';
      }

      std::optional<AccountNumber> getRedirect(const AccountNumber& account)
      {
         auto row = HttpServer::Tables(HttpServer::service, KvMode::read)
                        .open<RedirectTable>()
                        .get(account);
         if (row)
            return row->destination;
         return std::nullopt;
      }

      std::optional<AccountNumber> getTargetService(const HttpRequest& req,
                                                    std::string_view   rootHost)
      {
         if (!isSubdomain(req, rootHost))
            return std::nullopt;

         return AccountNumber(req.host.substr(0, req.host.size() - rootHost.size() - 1));
      }
   }  // namespace

   void HttpServer::registerServer(AccountNumber server)
   {
      auto sender = getSender();
      check(!sender.subaccount(), "Subaccounts do not have domain names");
      Tables{getReceiver()}.open<RegServTable>().put(RegisteredServiceRow{
          .service = sender,
          .server  = server,
      });
   }

   std::optional<AccountNumber> HttpServer::getServer(AccountNumber service)
   {
      if (auto row = Tables{getReceiver(), KvMode::read}.open<RegServTable>().get(service))
         return row->server;
      return std::nullopt;
   }

   static void checkRecvAuth(const Action& act)
   {
      if (act.sender != HttpServer::service)
         psibase::abortMessage("messages must have " + HttpServer::service.str() +
                               " as the sender");
      if (!(act.service == RTransact::service && act.method == MethodNumber{"recv"}))
         psibase::abortMessage(act.service.str() + "::" + act.method.str() +
                               " is not authorized to receive messages");
   }

   void HttpServer::recv(std::int32_t                        socket,
                         psio::pssz_view<std::vector<char>> data,
                         std::uint32_t                       flags)
   {
      check(getSender() == XHttp::service, "Wrong sender");
      if (socket == producer_multicast)
      {
         auto act = psio::from_pssz<Action>(data);
         checkRecvAuth(act);
         auto _ = recurse();
         psibase::call(act);
      }
   }

   void HttpServer::sendProds(const Action& action)
   {
      if (getSender() != action.service)
         psibase::abortMessage(getSender().str() + " cannot send messages to " + action.service.str());
      checkRecvAuth(action);
      // The message is the packed action, written into the call.
      to<XHttp>().send(producer_multicast, psio::packed(action), 0);
   }

   namespace
   {
      constexpr std::string_view allowedHeaders[] = {"Access-Control-Allow-Credentials",  //
                                                     "Access-Control-Allow-Headers",
                                                     "Access-Control-Allow-Methods",
                                                     "Access-Control-Allow-Origin",
                                                     "Allow",
                                                     "Cache-Control",
                                                     "Content-Encoding",
                                                     "Content-Security-Policy",
                                                     "ETag",
                                                     "Location",
                                                     "Set-Cookie",
                                                     "Vary",
                                                     "X-Content-Type-Options"};

      void sendReplyImpl(AccountNumber service, std::int32_t socket, HttpReply&& result)
      {
         for (const auto& header : result.headers)
         {
            if (!std::ranges::binary_search(allowedHeaders, header.name))
            {
               abortMessage("service " + service.str() + " attempted to set http header " +
                            header.name);
            }
         }

         to<XHttp>().sendReply(socket, result);
      }

      struct TempPendingRequestRow
      {
         std::int32_t                              socket;
         psibase::AccountNumber                    owner;
         std::optional<std::vector<AccountNumber>> prevOwners;
         PSIO_REFLECT(TempPendingRequestRow, socket, owner, prevOwners)
      };
      using TempPendingRequestTable =
          psibase::Table<TempPendingRequestRow, &TempPendingRequestRow::socket>;

      using Temporary = TemporaryTables<TempPendingRequestTable>;
   }  // namespace

   void HttpServer::deferReply(std::int32_t socket)
   {
      auto sender = getSender();
      auto owned  = Temporary{}.open<TempPendingRequestTable>();
      auto row    = owned.getIndex<0>().get(socket);
      if (row && row->owner == sender)
      {
         PSIBASE_SUBJECTIVE_TX
         {
            auto requests = HttpServer::Session{}.open<PendingRequestTable>();
            requests.put({row->socket, row->owner});
            owned.remove(*row);
            to<XHttp>().autoClose(socket, false);
         }
      }
      else
      {
         abortMessage(sender.str() + " cannot send a response on socket " + std::to_string(socket));
      }
   }

   void HttpServer::claimReply(std::int32_t socket)
   {
      auto sender = getSender();
      PSIBASE_SUBJECTIVE_TX
      {
         auto requests = Session{}.open<PendingRequestTable>();
         auto owned    = Temporary{}.open<TempPendingRequestTable>();
         auto row      = requests.get(socket);
         if (row && row->owner == sender)
         {
            requests.remove(*row);
            owned.put({row->socket, row->owner});
         }
         else
         {
            abortMessage(sender.str() + " cannot send a response on socket " +
                         std::to_string(socket));
         }
         to<XHttp>().autoClose(socket, true);
      }
   }

   void HttpServer::sendReply(std::int32_t socket, HttpReply result)
   {
      bool okay   = false;
      auto sender = getSender();
      auto owned  = Temporary{}.open<TempPendingRequestTable>();
      if (auto row = owned.get(socket))
      {
         if (row->owner == sender)
         {
            owned.remove(*row);
            okay = true;
         }
      }
      else
      {
         PSIBASE_SUBJECTIVE_TX
         {
            auto requests = Session{}.open<PendingRequestTable>();
            auto row      = requests.get(socket);
            if (row && row->owner == sender)
            {
               requests.remove(*row);
               to<XHttp>().autoClose(socket, true);
               okay = true;
            }
         }
      }
      if (!okay)
      {
         abortMessage(sender.str() + " cannot send a response on socket " + std::to_string(socket));
      }
      sendReplyImpl(sender, socket, std::move(result));
   }

   void HttpServer::giveSocket(std::int32_t socket, AccountNumber service)
   {
      auto sender = getSender();
      auto owned  = Temporary{}.open<TempPendingRequestTable>();
      if (sender == XHttp::service)
      {
         owned.put({.socket = socket, .owner = service});
      }
      else
      {
         auto row = owned.get(socket);
         if (!row || row->owner != sender)
            abortMessage(std::format("{} does not own socket {}", sender.str(), socket));
         if (!row->prevOwners)
            row->prevOwners.emplace();
         row->prevOwners->push_back(sender);
         row->owner = service;
         if (std::ranges::contains(*row->prevOwners, service))
            abortMessage("recursive transfer of socket");
         owned.put(*row);
      }
   }

   bool HttpServer::takeSocket(std::int32_t socket)
   {
      auto sender = getSender();
      auto owned  = Temporary{}.open<TempPendingRequestTable>();
      auto row    = owned.get(socket);
      if (sender == XHttp::service)
      {
         if (!row)
            return false;
         owned.remove(*row);
         return true;
      }
      else
      {
         if (!row || !row->prevOwners)
            return false;

         auto pos = std::ranges::find(*row->prevOwners, sender);
         if (pos == row->prevOwners->end())
            return false;
         row->prevOwners->erase(pos, row->prevOwners->end());
         if (row->prevOwners->empty())
            row->prevOwners.reset();
         row->owner = sender;
         owned.put(*row);
         return true;
      }
   }

   namespace
   {
      constexpr auto supervisorService = AccountNumber{"supervisor"};
      constexpr auto transactService   = AccountNumber{"transact"};
      constexpr auto signInPath        = "/sign-in.html";

      // Requests that must work with no session, or nobody could get one.
      bool gateExempt(AccountNumber service, const HttpRequest& req)
      {
         // Preflights never carry credentials.
         if (req.method == "OPTIONS")
            return true;
         // The sign-in page and the supervisor's own files.
         if (service == supervisorService)
            return true;
         // Shared library, root-domain lookup and the cookie-install endpoint.
         if (service == HttpServer::commonApiService)
            return true;
         if (service == transactService)
         {
            auto path = req.path();
            // Logging in, and transactions, which carry their own signature.
            return path == "/login" || path == "/guest-login" || path == "/push_transaction";
         }
         return false;
      }

      // True for a top-level page load, where a redirect is the right answer.
      bool isNavigation(const HttpRequest& req)
      {
         if (req.method != "GET")
            return false;
         if (auto mode = req.getHeader("sec-fetch-mode"))
            return *mode == "navigate";
         // Clients that do not send fetch metadata: go by what they accept.
         if (auto accept = req.getHeader("accept"))
            return accept->find("text/html") != std::string_view::npos;
         return false;
      }

      std::string percentEncode(std::string_view in)
      {
         static const char digits[] = "0123456789ABCDEF";
         std::string       out;
         for (unsigned char ch : in)
         {
            if (std::isalnum(ch) || ch == '-' || ch == '_' || ch == '.' || ch == '~' || ch == '/')
               out += static_cast<char>(ch);
            else
            {
               out += '%';
               out += digits[ch >> 4];
               out += digits[ch & 15];
            }
         }
         return out;
      }
   }  // namespace

   void HttpServer::serve(std::int32_t sock, HttpRequest req, bool requireIdentity)
   {
      check(getSender() == XHttp::service, "Wrong sender");

      auto session = recurse().to<RTransact>().getSession(req);
      auto user    = session.user;

      // Remove sensitive headers
      http_detail::stripAuthenticationHeaders(req);

      // Extract subdomain
      auto root        = to<XHttp>().rootHost(req.host);
      auto service_opt = getTargetService(req, root);

      auto redirect = [&](const psibase::AccountNumber& subdomain)
      {
         auto loc  = getSiblingUrl(req, std::optional{sock}, subdomain, true);
         auto hdrs = allowCors();
         hdrs.push_back({"Location", loc});
         HttpReply reply{.status      = HttpStatus::permanentRedirect,
                         .contentType = "text/html",
                         .headers     = std::move(hdrs)};
         sendReplyImpl(HttpServer::service, sock, std::move(reply));
      };

      // If the root host is requested directly, redirect to the homepage
      if (!service_opt)
      {
         redirect(homepageService);
         return;
      }

      // Subaccounts don't have domain names. This is a defensive check
      // that should never be reached, because the subaccount separator
      // is not allowed in a hostname.
      if (service_opt->subaccount())
      {
         std::string msg = "The resource '" + req.target + "' was not found";
         sendReplyImpl(HttpServer::service, sock,
                       {.status      = HttpStatus::notFound,
                        .contentType = "text/html",
                        .body        = std::vector(msg.begin(), msg.end()),
                        .headers     = allowCors()});
         return;
      }

      // If the subdomain has a redirect set, that takes precedence
      if (auto dest = getRedirect(*service_opt))
      {
         redirect(*dest);
         return;
      }

      // If the path is to the common api, force proxy to the common api service
      auto service =
          (req.target.starts_with(HttpServer::commonApiPrefix) ? HttpServer::commonApiService
                                                               : service_opt.value());

      // No app code runs for a request that nobody can be billed for.
      if (requireIdentity && !session.identified() && !gateExempt(service, req))
      {
         if (isNavigation(req))
         {
            auto loc = getSiblingUrl(req, std::optional{sock}, supervisorService, false);
            loc.pop_back();  // getSiblingUrl ends with '/'
            loc += signInPath;
            loc += "?app=" + service_opt->str() + "&path=" + percentEncode(req.target);
            auto hdrs = allowCors();
            hdrs.push_back({"Location", loc});
            hdrs.push_back({"Cache-Control", "no-store"});
            sendReplyImpl(HttpServer::service, sock,
                          {.status      = HttpStatus::found,
                           .contentType = "text/html",
                           .headers     = std::move(hdrs)});
         }
         else
         {
            std::string_view msg  = R"({"error":"sign-in required"})";
            auto             hdrs = allowCors();
            hdrs.push_back({"Cache-Control", "no-store"});
            sendReplyImpl(HttpServer::service, sock,
                          {.status      = HttpStatus::unauthorized,
                           .contentType = "application/json",
                           .body        = std::vector(msg.begin(), msg.end()),
                           .headers     = std::move(hdrs)});
         }
         return;
      }

      // First check the registered server
      auto                     registered = getServer(service);
      std::optional<HttpReply> result;
      psibase::AccountNumber   server;

      auto owned = Temporary{getReceiver()}.open<TempPendingRequestTable>();

      auto checkServer = [&](psibase::AccountNumber srv)
      {
         server = srv;
         owned.put({.socket = sock, .owner = server});
         return recurse().to<ServerInterface>(server).serveSys(req, std::optional{sock}, user);
      };

      if (registered)
      {
         result = checkServer(*registered);
      }

      // Otherwise, check the sites service
      if (!registered || (!result && owned.get(sock)))
      {
         result = checkServer("sites"_a);
      }

      if (owned.get(sock))
      {
         if (result)
         {
            sendReplyImpl(server, sock, std::move(*result));
         }
         else if (req.method == "OPTIONS")
         {
            sendReplyImpl(server, sock,
                          {.status = HttpStatus::ok,
                           .headers = http_detail::defaultPreflightHeaders()});
         }
         else
         {
            std::string msg = "The resource '" + req.target + "' was not found";
            sendReplyImpl(server, sock,
                          {.status      = HttpStatus::notFound,
                           .contentType = "text/html",
                           .body        = std::vector(msg.begin(), msg.end()),
                           .headers     = allowCors()});
         }
      }
   }  // serve()

   std::string HttpServer::rootHost(psio::pssz_view<std::string> host)
   {
      return to<XHttp>().rootHost(host);
   }

   std::string HttpServer::getSiblingUrl(const psibase::HttpRequest& req,
                                         std::optional<std::int32_t> socket,
                                         AccountNumber               destination,
                                         bool                        keepTarget)
   {
      auto rootHost = to<XHttp>().rootHost(req.host);

      check(iequal(req.host, rootHost) || isSubdomain(req, rootHost),
            "request host invalid: \"" + req.host + "\"");

      std::string siblingUrlHost = destination.str();
      siblingUrlHost.push_back('.');
      siblingUrlHost.append(rootHost);

      std::string scheme;
      if (auto proto = forwardedProto(req))
         scheme = *proto + "://";
      else if (socket)
         scheme = to<XHttp>().isSecure(*socket) ? "https://" : "http://";
      else
         scheme = isLocalhost(req) ? "http://" : "https://";

      std::string url = scheme + siblingUrlHost;

      url.append(hostHeaderPortSuffix(req));

      url += (keepTarget ? req.target : "/");

      return url;
   }

   void HttpServer::setRedirect(AccountNumber destination)
   {
      auto sender = getSender();
      check(!sender.subaccount(), "Subaccounts do not have domain names");
      check(destination != sender, "redirect destination must not be the sender");
      Tables{getReceiver()}.open<RedirectTable>().put(RedirectRow{
          .account     = sender,
          .destination = destination,
      });
   }

   void HttpServer::clearRedirect()
   {
      auto table = Tables{getReceiver()}.open<RedirectTable>();
      table.erase(getSender());
   }
}  // namespace SystemService

PSIBASE_DISPATCH(SystemService::HttpServer)
