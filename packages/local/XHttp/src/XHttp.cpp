#include <services/local/XHttp.hpp>

#include <psibase/dispatch.hpp>
#include <psibase/webServices.hpp>

using namespace psibase;
using namespace LocalService;
using namespace SystemService;

using Temporary = TemporaryTables<PendingRequestTable>;

namespace
{
   HttpReply error(HttpStatus status, std::string_view msg)
   {
      return {.status      = status,
              .contentType = "text/html",
              .body        = std::vector(msg.begin(), msg.end())};
   }
}  // namespace

extern "C" [[clang::export_name("recv")]] void recv()
{
   auto act       = getCurrentActionView();
   act->sender()  = XHttp::service;
   act->service() = HttpServer::service;
   act->method()  = MethodNumber{"recv"};
   psibase::call(act.data(), act.size());
}

void XHttp::send(std::int32_t socket, psio::view<const std::vector<char>> data)
{
   check(getSender() == HttpServer::service, "Wrong sender");
   check(socket == producer_multicast, "Cannot call send on this socket");
   psibase::socketSend(socket, data);
}

void XHttp::autoClose(std::int32_t socket, bool value)
{
   auto sender = getSender();
   PSIBASE_SUBJECTIVE_TX
   {
      auto requests = Subjective{}.open<PendingRequestTable>();
      auto owned    = Temporary{}.open<PendingRequestTable>();

      auto from = value ? &requests : &owned;
      auto to   = value ? &owned : &requests;
      auto row  = from->get(socket);
      if (row && row->owner == sender)
      {
         from->remove(*row);
         to->put(*row);
      }
      else
      {
         if (auto row = to->get(socket); !row || row->owner != sender)
            abortMessage(sender.str() + " cannot send a response on socket " +
                         std::to_string(socket));
      }
      socketAutoClose(socket, value);
   }
}

void XHttp::sendReply(std::int32_t socket, const HttpReply& result)
{
   auto sender = getSender();
   auto owned  = Temporary{}.open<PendingRequestTable>();
   if (auto row = owned.get(socket))
   {
      if (row->owner != sender)
      {
         abortMessage(sender.str() + " cannot send a response on socket " + std::to_string(socket));
      }
      owned.remove(*row);
   }
   else
   {
      abortMessage("Must set autoClose before sending a response");
   }
   socketSend(socket, psio::to_frac(result));
}

extern "C" [[clang::export_name("serve")]] void serve()
{
   auto act = getCurrentActionView();

   auto [sockview, req] = psio::view<const std::tuple<std::int32_t, HttpRequest>>(act->rawData());
   auto sock            = sockview.unpack();

   auto owned = Temporary{act->service()}.open<PendingRequestTable>();

   std::string_view host     = req.host();
   std::string_view rootHost = req.rootHost();
   if (host.size() > rootHost.size() + 1 && host.ends_with(rootHost) &&
       host[host.size() - rootHost.size() - 1] == '.')
   {
      std::string_view serviceName(host);
      serviceName.remove_suffix(rootHost.size() + 1);
      AccountNumber service{serviceName};
      if (service != AccountNumber{})
      {
         // Handle local service subdomains
         std::optional<CodeRow> row;
         PSIBASE_SUBJECTIVE_TX
         {
            row = kvGet<CodeRow>(DbId::nativeSubjective, codeKey(service));
         }
         if (row && !(row->flags & CodeRow::isReplacement))
         {
            owned.put({.socket = sock, .owner = service});
            auto reply = psibase::Actor<ServerInterface>(XHttp::service, service)
                             .serveSys(req.unpack(), std::optional{sock}, std::nullopt);

            if (owned.get(sock))
            {
               if (!reply)
               {
                  if (std::string_view{req.target()}.starts_with("/native/"))
                  {
                     return;
                  }
                  else
                  {
                     reply = error(HttpStatus::notFound,
                                   "The resource '" + req.target().unpack() + "' was not found");
                  }
               }
               psibase::socketSend(sock, psio::to_frac(std::move(*reply)));
            }
            return;
         }
      }
   }
   else if (std::string_view{req.target()} == "/native/p2p")
   {
      return;
   }
   else if (std::string_view{req.target()}.starts_with("/native/"))
   {
      auto reply =
          error(HttpStatus::notFound, "The resource '" + req.target().unpack() + "' was not found");
      psibase::socketSend(sock, psio::to_frac(std::move(reply)));
      return;
   }

   // Forward other requests to HttpServer
   owned.put({.socket = sock, .owner = HttpServer::service});
   act->sender()  = XHttp::service;
   act->service() = HttpServer::service;
   act->method()  = MethodNumber("serve");
   psibase::call(act.data(), act.size());
}  // serve()

PSIBASE_DISPATCH(XHttp)
