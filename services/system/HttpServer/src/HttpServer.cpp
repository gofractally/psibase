#include <psibase/dispatch.hpp>
#include <psibase/nativeTables.hpp>
#include <psibase/webServices.hpp>
#include <psio/fracpack.hpp>
#include <services/system/HttpServer.hpp>
#include <services/system/TransactionQueue.hpp>
#include "services/system/Accounts.hpp"

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

   }  // namespace

   // TODO: switch to Table wrapper
   using table_num = uint16_t;

   static constexpr table_num registeredServiceTable = 1;

   inline auto registeredServiceKey(AccountNumber thisService, AccountNumber service)
   {
      return std::tuple{thisService, registeredServiceTable, service};
   }
   struct RegisteredServiceRow
   {
      AccountNumber service = {};
      AccountNumber server  = {};

      auto key(AccountNumber thisService) { return registeredServiceKey(thisService, service); }
   };
   PSIO_REFLECT(RegisteredServiceRow, service, server)

   void HttpServer::registerServer(AccountNumber server)
   {
      RegisteredServiceRow row{
          .service = getSender(),
          .server  = server,
      };
      kvPut(row.key(getReceiver()), row);
   }

   static void checkRecvAuth(const Action& act)
   {
      if (act.sender != HttpServer::service)
         psibase::abortMessage("messages must have " + HttpServer::service.str() +
                               " as the sender");
      if (!(act.service == TransactionQueue::service && act.method == MethodNumber{"recv"}))
         psibase::abortMessage(act.service.str() + "::" + act.method.str() +
                               " is not authorized to receive messages");
   }

   void HttpServer::recv(std::int32_t socket, psio::view<const std::vector<char>> data)
   {
      check(getSender() == AccountNumber{}, "recv can only be called by native");
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

      void sendReplyImpl(AccountNumber                   service,
                         std::int32_t                    socket,
                         const std::optional<HttpReply>& result)
      {
         if (result && service != AccountNumber{"common-api"})
         {
            for (const auto& header : result->headers)
            {
               if (!std::ranges::binary_search(allowedHeaders, header.name))
               {
                  abortMessage("service " + service.str() + " attempted to set http header " +
                               header.name);
               }
            }
         }

         socketSend(socket, psio::to_frac(result));
      }

      std::optional<PendingRequestRow> currentRequest;
   }  // namespace

   void HttpServer::sendReply(std::int32_t socket, const std::optional<HttpReply>& result)
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
            if (row && row->owner == sender)
            {
               requests.remove(*row);
               okay = true;
            }
            else
            {
               okay = false;
            }
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
      auto act = getCurrentAction();
      // TODO: use a view
      auto [sock, req] = psio::from_frac<std::tuple<std::int32_t, HttpRequest>>(act.rawData);

      std::string serviceName;

      // Path reserved across all subdomains
      if (req.target.starts_with("/common"))
         serviceName = "common-api";

      // subdomain
      else if (isSubdomain(req))
         serviceName.assign(req.host.begin(), req.host.end() - req.rootHost.size() - 1);

      // root domain
      else
         serviceName = "common-api";

      auto service = AccountNumber(serviceName);
      auto reg     = kvGet<RegisteredServiceRow>(registeredServiceKey(act.service, service));
      if (reg)
         service = reg->server;
      else
         service = "sites"_a;

      // TODO: configure interface with registerServer
      if (service == AccountNumber{"txqueue"})
      {
         currentRequest = {.socket = sock, .owner = service};

         psibase::Actor<AsyncServerInterface> iface(act.service, service);
         iface.serveSys(sock, std::move(req));

         if (currentRequest)
         {
            PSIBASE_SUBJECTIVE_TX
            {
               auto requests = HttpServer::Subjective{act.service}.open<PendingRequestTable>();
               requests.put(*currentRequest);
            }
            currentRequest.reset();
         }
         return;
      }
      else
      {
         // TODO: avoid repacking (both directions)
         psibase::Actor<ServerInterface> iface(act.service, service);
         sendReplyImpl(service, sock, iface.serveSys(std::move(req)));
      }
   }  // serve()

}  // namespace SystemService

PSIBASE_DISPATCH(SystemService::HttpServer)
