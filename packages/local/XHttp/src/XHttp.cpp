#include <services/local/XHttp.hpp>

#include <psibase/dispatch.hpp>
#include <psibase/webServices.hpp>
#include <services/local/XAdmin.hpp>
#include <services/local/XDb.hpp>
#include <services/local/XSites.hpp>

using namespace psibase;
using namespace LocalService;
using namespace SystemService;

using Temporary = TemporaryTables<PendingRequestTable>;

namespace
{
   bool matches(psio::view<const HttpHeader> header, std::string_view h)
   {
      return std::ranges::equal(std::string_view{header.name()}, h, {}, ::tolower, ::tolower);
   }

   std::string getUrl(psio::view<const HttpRequest> req,
                      std::int32_t                  socket,
                      std::optional<AccountNumber>  subdomain = {})
   {
      std::string              location;
      std::optional<SocketRow> socketRow;
      PSIBASE_SUBJECTIVE_TX
      {
         socketRow = Native::session(KvMode::read).open<SocketTable>().get(socket);
      }
      if (std::get<HttpSocketInfo>(socketRow.value().info).tls)
         location += "https://";
      else
         location += "http://";
      if (subdomain)
      {
         location += subdomain->str();
         location += '.';
      }
      location += req.rootHost();
      for (auto header : req.headers())
      {
         if (matches(header, "host"))
         {
            std::string_view host = header.value();
            if (auto pos = host.rfind(':'); pos != std::string::npos)
            {
               if (host.find(']', pos) == std::string::npos)
               {
                  location.append(host.substr(pos));
               }
            }
            break;
         }
      }
      if (subdomain)
         location += '/';
      else
         location += req.target();
      return location;
   }

   HttpReply error(HttpStatus status, std::string_view msg)
   {
      return {.status      = status,
              .contentType = "text/html",
              .body        = std::vector(msg.begin(), msg.end())};
   }

   HttpReply redirect(HttpStatus status, std::format_string<std::string> fmt, std::string location)
   {
      auto headers = allowCors();
      headers.push_back({"Location", location});
      HttpReply result{
          .status      = status,
          .contentType = "text/html",
          .headers     = std::move(headers),
      };
      std::format_to(std::back_inserter(result.body), fmt,
                     std::format(R"(<a href="{0}">{0}</a>)", location));
      return result;
   }

   void sendNotFound(std::int32_t sock, psio::view<const HttpRequest> req)
   {
      auto reply =
          error(HttpStatus::notFound, "The resource '" + req.target().unpack() + "' was not found");
      psibase::socketSend(sock, psio::to_frac(std::move(reply)));
   }

   bool chainIsBooted()
   {
      auto mode   = KvMode::read;
      auto prefix = std::span<const char>();
      auto native = Native::Tables{to<XDb>().open(DbId::native, prefix, mode), mode};
      auto row    = native.open<StatusTable>().get({});
      return row && row->head;
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
      auto requests = Session{}.open<PendingRequestTable>();
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

#ifndef PSIBASE_GENERATE_SCHEMA

extern "C" [[clang::export_name("startSession")]] void startSession()
{
   psibase::internal::receiver = XHttp::service;
   to<XAdmin>().startSession();
}

extern "C" [[clang::export_name("serve")]] void serve()
{
   auto act                    = getCurrentActionView();
   psibase::internal::receiver = XHttp::service;

   auto [sockview, req] = psio::view<const std::tuple<std::int32_t, HttpRequest>>(act->rawData());
   auto sock            = sockview.unpack();

   auto owned = Temporary{act->service(), KvMode::readWrite}.open<PendingRequestTable>();

   if (auto service = XHttp::getService(req); service != AccountNumber{})
   {
      // Handle local service subdomains
      auto                   codeTable = Native::subjective(KvMode::read).open<CodeTable>();
      std::optional<CodeRow> row;
      PSIBASE_SUBJECTIVE_TX
      {
         row = codeTable.get(service);
      }
      if (row && !(row->flags & CodeRow::isReplacement))
      {
         owned.put({.socket = sock, .owner = service});
         auto reply = psibase::Actor<ServerInterface>(XHttp::service, service)
                          .serveSys(req.unpack(), std::optional{sock}, std::nullopt);

         if (!reply && owned.get(sock))
         {
            if (service == XAdmin::service &&
                std::string_view{req.target()}.starts_with("/native/"))
            {
               return;
            }
            PSIBASE_SUBJECTIVE_TX
            {
               row = codeTable.get(XSites::service);
            }
            if (row)
            {
               reply = psibase::Actor<ServerInterface>(XHttp::service, XSites::service)
                           .serveSys(req.unpack(), std::optional{sock}, std::nullopt);
            }
         }

         if (owned.get(sock))
         {
            if (reply)
            {
               psibase::socketSend(sock, psio::to_frac(std::move(*reply)));
            }
            else
            {
               sendNotFound(sock, req);
            }
         }
         return;
      }
   }
   else if (req.rootHost() != req.host() && std::string_view{req.target()} != "/native/p2p")
   {
      if (!req.rootHost().empty())
      {
         std::string location = getUrl(req, sock);
         auto        reply    = redirect(HttpStatus::found,
                                         R"(<html><body>This psibase server is hosted at {}.</body></html>)",
                                         location);
         psibase::socketSend(sock, psio::to_frac(std::move(reply)));
      }
      else
      {
         sendNotFound(sock, req);
      }
      return;
   }

   if (std::string_view{req.target()} == "/native/p2p")
   {
      auto opts = to<XAdmin>().options();
      if (!opts.p2p)
         sendNotFound(sock, req);
      return;
   }
   else if (std::string_view{req.target()}.starts_with("/native/"))
   {
      sendNotFound(sock, req);
      return;
   }

   if (!chainIsBooted())
   {
      if (req.method() == "GET" || req.method() == "HEAD")
      {
         std::string location = getUrl(req, sock, XAdmin::service);
         auto        reply    = redirect(
             HttpStatus::found,
             R"(<html><body>Node is not connected to any psibase network.  Visit {} for node setup.</body></html>)",
             location);
         psibase::socketSend(sock, psio::to_frac(std::move(reply)));
      }
      else
      {
         auto reply =
             error(HttpStatus::serviceUnavailable,
                   "<html><body>Node is not connected to any psibase network.</body></html>");
         psibase::socketSend(sock, psio::to_frac(std::move(reply)));
      }
      return;
   }

   // Forward other requests to HttpServer
   owned.put({.socket = sock, .owner = HttpServer::service});
   act->sender()  = XHttp::service;
   act->service() = HttpServer::service;
   act->method()  = MethodNumber("serve");
   psibase::call(act.data(), act.size());
}  // serve()

#endif

PSIBASE_DISPATCH(XHttp)
