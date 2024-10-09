#include <psibase/dispatch.hpp>
#include <psibase/nativeTables.hpp>
#include <psibase/psibase.hpp>
#include <psibase/webServices.hpp>
#include <psio/fracpack.hpp>
#include <services/system/HttpServer.hpp>
#include <services/system/RTransact.hpp>
#include "services/system/Accounts.hpp"

#include <algorithm>

static constexpr bool enable_print = false;

using namespace psibase;

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
         if (req.target.starts_with("/common"))
            serviceName = "common-api";

         // subdomain
         else if (isSubdomain(req))
            serviceName.assign(req.host.begin(), req.host.end() - req.rootHost.size() - 1);

         // root domain
         else
            serviceName = "homepage";

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
      constexpr std::string_view allowedHeaders[] = {"Content-Encoding"};

      void sendReplyImpl(AccountNumber service, std::int32_t socket, const HttpReply& result)
      {
         for (const auto& header : result.headers)
         {
            if (!std::ranges::binary_search(allowedHeaders, header.name))
            {
               abortMessage("service " + service.str() + " attempted to set http header " +
                            header.name);
            }
         }

         socketSend(socket, psio::to_frac(result));
      }

      std::vector<PendingRequestRow>   ownedRequests;
      std::optional<PendingRequestRow> currentRequest;
   }  // namespace

   void HttpServer::deferReply(std::int32_t socket)
   {
      auto sender = getSender();
      if (currentRequest && currentRequest->owner == sender && currentRequest->socket == socket)
      {
         PSIBASE_SUBJECTIVE_TX
         {
            auto requests = HttpServer::Subjective{}.open<PendingRequestTable>();
            requests.put(*currentRequest);
            socketAutoClose(socket, false);
         }
         currentRequest.reset();
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
         auto row      = requests.get(socket);
         if (row && row->owner == sender)
         {
            requests.remove(*row);
            if (auto pos = std::ranges::find_if(ownedRequests,
                                                [&](auto& r) { return r.socket == socket; });
                pos != ownedRequests.end())
            {
               *pos = *row;
            }
            else
            {
               ownedRequests.push_back(*row);
            }
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
      if (currentRequest && currentRequest->socket == socket)
      {
         if (currentRequest->owner == sender)
         {
            currentRequest.reset();
            okay = true;
         }
      }
      else
      {
         PSIBASE_SUBJECTIVE_TX
         {
            auto requests = Subjective{}.open<PendingRequestTable>();
            auto row      = requests.get(socket);
            if (!row)
            {
               if (auto pos = std::ranges::find_if(ownedRequests,
                                                   [&](auto& r) { return r.socket == socket; });
                   pos != ownedRequests.end() && pos->owner == sender)
               {
                  ownedRequests.erase(pos);
                  okay = true;
               }
               else
               {
                  okay = false;
               }
            }
            else if (row && row->owner == sender)
            {
               requests.remove(*row);
               okay = true;
            }
            else
            {
               okay = false;
            }
            if (okay && socketAutoClose(socket, true) != 0)
               okay = false;
         }
      }
      if (!okay)
      {
         abortMessage(sender.str() + " cannot send a response on socket " + std::to_string(socket));
      }
      sendReplyImpl(sender, socket, result);
   }

   extern "C" [[clang::export_name("serve")]] void serve()
   {
      auto act   = getCurrentAction();
      auto iface = [&](AccountNumber server)
      { return psibase::Actor<ServerInterface>(act.service, server); };

      // TODO: use a view
      auto [sock, req] = psio::from_frac<std::tuple<std::int32_t, HttpRequest>>(act.rawData);

      // First we check the registered server
      auto service    = getTargetService(req);
      auto registered = getServer(service);
      std::optional<HttpReply> result;
      psibase::AccountNumber server;

      auto checkServer = [&](psibase::AccountNumber srv) {
         server = srv;
         currentRequest = {.socket = sock, .owner = server};
         return iface(server).serveSys(req, std::optional{sock});
      };

      if (registered)
      {
         result = checkServer(registered->server);
      }

      if (!registered || (!result && currentRequest))
      {
         result = checkServer("sites"_a);
      }

      if (currentRequest)
      {
         if (result)
         {
            sendReplyImpl(server, sock, std::move(*result));
         }
         else
         {
            std::string msg = "The resource '" + req.target + "' was not found";
            sendReplyImpl(server, sock,
                          {.status      = HttpStatus::notFound,
                           .contentType = "text/html",
                           .body        = std::vector(msg.begin(), msg.end())});
         }
         currentRequest.reset();
      }
   }  // serve()

}  // namespace SystemService

PSIBASE_DISPATCH(SystemService::HttpServer)
