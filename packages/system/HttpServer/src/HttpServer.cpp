#include <psibase/dispatch.hpp>
#include <psibase/psibase.hpp>
#include <psibase/webServices.hpp>
#include <psio/fracpack.hpp>
#include <services/local/XHttp.hpp>
#include <services/system/HttpServer.hpp>
#include <services/system/RTransact.hpp>
#include "psibase/api.hpp"

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
         std::string serviceName;

         // Path reserved across all subdomains
         if (req.target.starts_with(HttpServer::commonApiPrefix))
            serviceName = HttpServer::commonApiService.str();

         // subdomain
         else if (isSubdomain(req, rootHost))
            serviceName.assign(req.host.begin(), req.host.end() - rootHost.size() - 1);

         // root domain
         else
            return std::nullopt;

         return AccountNumber(serviceName);
      }

      constexpr AccountNumber DEFAULT_HOMEPAGE = AccountNumber("network");
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

   void HttpServer::setHomepage(AccountNumber subdomain)
   {
      check(getSender() == getReceiver(), "Wrong sender");

      auto table = Tables{getReceiver()}.open<ConfigTable>();
      if (auto config = table.get({}))
      {
         if (config->homepageSubdomain == subdomain)
            return;

         table.put(
             ConfigRow{.previous = config->homepageSubdomain, .homepageSubdomain = subdomain});
      }

      table.put(ConfigRow{.previous = DEFAULT_HOMEPAGE, .homepageSubdomain = subdomain});
   }

   AccountNumber HttpServer::homepage()
   {
      auto config =
          HttpServer::Tables(HttpServer::service, KvMode::read).open<ConfigTable>().get({});

      if (config)
      {
         return config->homepageSubdomain;
      }
      return DEFAULT_HOMEPAGE;
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

      auto config =
          HttpServer::Tables(HttpServer::service, KvMode::read).open<ConfigTable>().get({});

      // Remove sensitive headers
      req.removeCookie("__HOST-SESSION");
      req.removeCookie("SESSION");
      std::erase_if(req.headers, [](auto& header) { return header.matches("authorization"); });

      // Extract subdomain
      auto root        = to<XHttp>().rootHost(req.host);
      auto service_opt = getTargetService(req, root);

      auto redirect = [&](const psibase::AccountNumber& subdomain)
      {
         auto loc  = to<XHttp>().absoluteUrl(sock, req, root,
                                             std::optional<AccountNumber>{subdomain}, true);
         auto hdrs = allowCors();
         hdrs.push_back({"Location", loc});
         HttpReply reply{.status      = HttpStatus::movedPermanently,
                         .contentType = "text/html",
                         .headers     = std::move(hdrs)};
         std::format_to(std::back_inserter(reply.body),
                        R"(<html><body><a href="{0}">{0}</a></body></html>)", loc);
         sendReplyImpl(HttpServer::service, sock, std::move(reply));
      };

      // If the root host is requested directly, redirect to the homepage
      if (!service_opt)
      {
         redirect(homepage());
         return;
      }
      // If navigating to previous homepage, redirect to the new homepage
      else if (config && service_opt.value() == config->previous)
      {
         redirect(config->homepageSubdomain);
         return;
      }

      // If the requested subdomain is the homepage, reverse proxy to the homepage service
      auto service = service_opt.value();
      if (service == homepage())
         service = AccountNumber{"homepage"};

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
}  // namespace SystemService

PSIBASE_DISPATCH(SystemService::HttpServer)
