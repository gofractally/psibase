#include <psibase/HttpHeaders.hpp>
#include <psibase/Rpc.hpp>
#include <psibase/api.hpp>
#include <psibase/dispatch.hpp>
#include <psibase/psibase.hpp>
#include <psibase/webServices.hpp>
#include <psio/fracpack.hpp>
#include <services/local/XHttp.hpp>
#include <services/system/HttpServer.hpp>
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

      std::optional<RegisteredServiceRow> getServer(const AccountNumber& server)
      {
         return HttpServer::Tables(HttpServer::service, KvMode::read)
             .open<RegServTable>()
             .get(server);
      }

      std::optional<AccountNumber> getTargetService(const HttpRequest& req,
                                                    std::string_view   rootHost)
      {
         if (!isSubdomain(req, rootHost))
            return std::nullopt;

         return AccountNumber(req.host.substr(0, req.host.size() - rootHost.size() - 1));
      }

      std::string_view hostHeaderPortSuffix(const HttpRequest& req)
      {
         if (auto host = HttpHeader::get(req.headers, "host"))
         {
            std::string_view h = *host;
            if (auto pos = h.rfind(':'); pos != std::string_view::npos)
            {
               if (h.find(']', pos) == std::string_view::npos)
                  return h.substr(pos);
            }
         }
         return {};
      }
   }  // namespace

   void HttpServer::registerServer(AccountNumber server)
   {
      Tables{getReceiver()}.open<RegServTable>().put(RegisteredServiceRow{
          .service = getSender(),
          .server  = server,
      });
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
                         psio::view<const std::vector<char>> data,
                         std::uint32_t                       flags)
   {
      check(getSender() == XHttp::service, "Wrong sender");
      if (socket == producer_multicast)
      {
         auto act = psio::from_frac<Action>(data);
         checkRecvAuth(act);
         auto _ = recurse();
         psibase::call(act);
      }
   }

   void HttpServer::sendProds(const Action& act)
   {
      if (getSender() != act.service)
         psibase::abortMessage(getSender().str() + " cannot send messages to " + act.service.str());
      checkRecvAuth(act);
      to<XHttp>().send(producer_multicast, psio::to_frac(act), 0);
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
                                                     "Set-Cookie"};

      void sendReplyImpl(AccountNumber service, std::int32_t socket, HttpReply&& result)
      {
         for (const auto& header : result.headers)
         {
            if (!std::ranges::binary_search(allowedHeaders, header.name))
            {
               // TODO: Convert to 500 error response (with cors on subdomains) instead of aborting.
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

   void HttpServer::serve(std::int32_t sock, HttpRequest req)
   {
      check(getSender() == XHttp::service, "Wrong sender");

      auto user = recurse().to<RTransact>().getUser(req);

      // Remove sensitive headers
      req.removeCookie("__HOST-SESSION");
      req.removeCookie("SESSION");
      std::erase_if(req.headers, [](auto& header) { return header.matches("authorization"); });

      // Extract subdomain
      auto root        = to<XHttp>().rootHost(req.host);
      auto service_opt = getTargetService(req, root);

      auto redirect = [&](const psibase::AccountNumber& subdomain)
      {
         auto loc  = getSiblingUrl(req, std::optional{sock}, subdomain);
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

      // If the path is to the common api, force proxy to the common api service
      auto service =
          (req.target.starts_with(HttpServer::commonApiPrefix) ? HttpServer::commonApiService
                                                               : service_opt.value());

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
         result = checkServer(registered->server);
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
            sendReplyImpl(server, sock, {.status = HttpStatus::ok, .headers = allowCors()});
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

   std::string HttpServer::rootHost(psio::view<const std::string> host)
   {
      return to<XHttp>().rootHost(host);
   }

   std::string HttpServer::getSiblingUrl(HttpRequest                 req,
                                         std::optional<std::int32_t> socket,
                                         AccountNumber               destination)
   {
      auto rootHost = to<XHttp>().rootHost(req.host);

      check(req.host.size() >= rootHost.size(), "request host invalid: \"" + req.host + "\"");

      std::string redirectUrlHost;
      if (iequal(req.host, rootHost))
      {
         redirectUrlHost = destination.str();
         redirectUrlHost.push_back('.');
         redirectUrlHost.append(rootHost);
      }
      else
      {
         auto prefixLen  = req.host.size() - rootHost.size() - 1;
         redirectUrlHost = req.host;
         redirectUrlHost.replace(0, prefixLen, destination.str());
      }

      std::string scheme;
      if (auto proto = forwardedProto(req))
         scheme = *proto + "://";
      else if (socket)
         scheme = to<XHttp>().is_secure(*socket) ? "https://" : "http://";
      else
         scheme = isLocalhost(req) ? "http://" : "https://";

      std::string url = scheme + redirectUrlHost;

      if (auto suf = hostHeaderPortSuffix(req); !suf.empty())
         url.append(suf);

      url += req.target;
      return url;
   }
}  // namespace SystemService

PSIBASE_DISPATCH(SystemService::HttpServer)
