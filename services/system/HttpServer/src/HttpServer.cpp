#include <psibase/dispatch.hpp>
#include <psibase/nativeTables.hpp>
#include <psibase/psibase.hpp>
#include <psibase/webServices.hpp>
#include <psio/fracpack.hpp>
#include <services/system/HttpServer.hpp>
#include <services/system/RTransact.hpp>
#include "services/system/Accounts.hpp"

#include <algorithm>
#include <ranges>

static constexpr bool enable_print = false;

using namespace psibase;

namespace
{
   // Used to convert a split_view element to a string_view.
   // Note that this is only needed when the standard library
   // doesn't implement P2210R2
   std::string_view split2sv(const auto& r)
   {
      auto data = &*r.begin();
      auto size = static_cast<std::size_t>(std::ranges::distance(r));
      return std::string_view{data, size};
   }
}  // namespace

namespace psibase
{
   bool isLocalhost(const std::string& url)
   {
      std::string_view value = url;
      
      // Trim whitespace
      auto leading = value.find_first_not_of(" \t");
      auto trailing = value.find_last_not_of(" \t");
      if (leading != std::string_view::npos)
      {
         value = value.substr(leading, trailing - leading + 1);
      }
      else
      {
         return false;
      }

      // Find position of scheme separator
      size_t pos = value.find("://");
      std::string_view domain;
      
      if (pos != std::string_view::npos)
      {
         // Create a string view starting after "://"
         domain = value.substr(pos + 3);
      }
      else
      {
         // No scheme found, treat entire value as domain
         domain = value;
      }

      // Find the end of the domain name (either at first colon or slash, or end of string)
      size_t domainEndPos = domain.find(':');
      if (domainEndPos == std::string_view::npos)
      {
         domainEndPos = domain.find('/');
      }
      if (domainEndPos != std::string_view::npos)
      {
         domain = domain.substr(0, domainEndPos);
      }

      return domain.find("localhost") != std::string_view::npos;
   }

   bool isDevChain(const HttpRequest& request)
   {
      // Check the host field first (always present)
      if (isLocalhost(request.host))
      {
         return true;
      }
      
      // Also check origin header if present (for cross-origin requests)
      if (auto originHeader = request.getHeader("origin"))
      {
         for (auto part : *originHeader | std::views::split(','))
         {
            std::string_view value = split2sv(part);
            std::string valueStr{value};
            
            if (isLocalhost(valueStr))
            {
               return true;
            }
         }
      }
      return false;
   }
}  // namespace psibase

namespace SystemService
{
   namespace
   {
      bool isSubdomain(const psibase::HttpRequest& req)
      {
         return req.host.size() > req.rootHost.size() + 1  //
                && req.host.ends_with(req.rootHost)        //
                && req.host[req.host.size() - req.rootHost.size() - 1] == '.';
      }

      std::optional<RegisteredServiceRow> getServer(const AccountNumber& server)
      {
         return HttpServer::Tables(HttpServer::service).open<RegServTable>().get(server);
      }

      AccountNumber getTargetService(const HttpRequest& req)
      {
         std::string serviceName;

         // Path reserved across all subdomains
         if (req.target.starts_with(HttpServer::commonApiPrefix))
            serviceName = HttpServer::commonApiService.str();

         // subdomain
         else if (isSubdomain(req))
            serviceName.assign(req.host.begin(), req.host.end() - req.rootHost.size() - 1);

         // root domain
         else
            serviceName = HttpServer::homepageService.str();

         return AccountNumber(serviceName);
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

   extern "C" [[clang::export_name("recv")]] void recv()
   {
      auto act = getCurrentActionView();
      auto [socket, data] =
          psio::view<const std::tuple<std::int32_t, std::vector<char>>>(act->rawData());
      if (socket == producer_multicast)
      {
         auto act = psio::from_frac<Action>(data);
         checkRecvAuth(act);
         psibase::call(act);
      }
   }

   void HttpServer::sendProds(const Action& act)
   {
      if (getSender() != act.service)
         psibase::abortMessage(getSender().str() + " cannot send messages to " + act.service.str());
      checkRecvAuth(act);
      socketSend(producer_multicast, psio::to_frac(act));
   }

   namespace
   {
      constexpr std::string_view allowedHeaders[] = {"Cache-Control",            //
                                                     "Content-Encoding",         //
                                                     "Content-Security-Policy",  //
                                                     "ETag",                     //
                                                     "Set-Cookie"};

      void sendReplyImpl(AccountNumber           service,
                         std::int32_t            socket,
                         const HttpReply&        result,
                         const std::string_view& requestTarget = "")
      {
         for (const auto& header : result.headers)
         {
            // Check standard allowed headers
            if (!std::ranges::binary_search(allowedHeaders, header.name))
            {
               abortMessage("service " + service.str() + " attempted to set http header " +
                            header.name);
            }
         }

         socketSend(socket, psio::to_frac(result));
      }

      using Temporary = TemporaryTables<PendingRequestTable>;
   }  // namespace

   void HttpServer::deferReply(std::int32_t socket)
   {
      auto sender = getSender();
      auto owned  = Temporary{}.open<PendingRequestTable>();
      auto row    = owned.getIndex<0>().get(socket);
      if (row && row->owner == sender)
      {
         PSIBASE_SUBJECTIVE_TX
         {
            auto requests = HttpServer::Subjective{}.open<PendingRequestTable>();
            requests.put(*row);
            owned.remove(*row);
            socketAutoClose(socket, false);
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
         auto requests = Subjective{}.open<PendingRequestTable>();
         auto owned    = Temporary{}.open<PendingRequestTable>();
         auto row      = requests.get(socket);
         if (row && row->owner == sender)
         {
            requests.remove(*row);
            owned.put(*row);
         }
         else
         {
            abortMessage(sender.str() + " cannot send a response on socket " +
                         std::to_string(socket));
         }
         socketAutoClose(socket, true);
      }
   }

   void HttpServer::sendReply(std::int32_t socket, const HttpReply& result)
   {
      bool okay   = false;
      auto sender = getSender();
      auto owned  = Temporary{}.open<PendingRequestTable>();
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
            auto requests = Subjective{}.open<PendingRequestTable>();
            auto row      = requests.get(socket);
            if (row && row->owner == sender)
            {
               requests.remove(*row);
               okay = true;
            }
            if (okay && socketAutoClose(socket, true) != 0)
               okay = false;
         }
      }
      if (!okay)
      {
         abortMessage(sender.str() + " cannot send a response on socket " + std::to_string(socket));
      }
      sendReplyImpl(sender, socket, result, "");
   }

   extern "C" [[clang::export_name("serve")]] void serve()
   {
      auto act = getCurrentAction();

      // TODO: use a view
      auto [sock, req] = psio::from_frac<std::tuple<std::int32_t, HttpRequest>>(act.rawData);

      Actor<RTransact> rtransact(act.service, RTransact::service);
      auto             user = rtransact.getUser(req);

      auto iface = [&](AccountNumber server)
      { return psibase::Actor<ServerInterface>(act.service, server); };

      // Remove sensitive headers
      req.removeCookie("__HOST-SESSION");
      std::erase_if(req.headers, [](auto& header) { return header.matches("authorization"); });

      // First we check the registered server
      auto                     service    = getTargetService(req);
      auto                     registered = getServer(service);
      std::optional<HttpReply> result;
      psibase::AccountNumber   server;

      auto owned = Temporary{act.service}.open<PendingRequestTable>();

      auto checkServer = [&](psibase::AccountNumber srv)
      {
         server = srv;
         owned.put({.socket = sock, .owner = server});
         return iface(server).serveSys(req, std::optional{sock}, user);
      };

      if (registered)
      {
         result = checkServer(registered->server);
      }

      if (!registered || (!result && owned.get(sock)))
      {
         result = checkServer("sites"_a);
      }

      if (owned.get(sock))
      {
         if (result)
         {
            sendReplyImpl(server, sock, std::move(*result), req.target);
         }
         else
         {
            std::string msg = "The resource '" + req.target + "' was not found";
            sendReplyImpl(server, sock,
                          {.status      = HttpStatus::notFound,
                           .contentType = "text/html",
                           .body        = std::vector(msg.begin(), msg.end())},
                          req.target);
         }
      }
   }  // serve()

}  // namespace SystemService

PSIBASE_DISPATCH(SystemService::HttpServer)
