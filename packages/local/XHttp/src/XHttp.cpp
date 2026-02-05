#include <services/local/XHttp.hpp>

#include <psibase/WebSocket.hpp>
#include <psibase/dispatch.hpp>
#include <psibase/webServices.hpp>
#include <services/local/XAdmin.hpp>
#include <services/local/XDb.hpp>
#include <services/local/XSites.hpp>

using namespace psibase;
using namespace LocalService;
using namespace SystemService;

namespace
{
   // This is used to store outgoing HTTP requests before their callbacks are set.
   struct TempResponseHandlerRow
   {
      std::int32_t           socket;
      SocketType             type;
      psibase::AccountNumber service;
   };
   PSIO_REFLECT(TempResponseHandlerRow, socket, type, service)
   using TempResponseHandlerTable = Table<TempResponseHandlerRow, &TempResponseHandlerRow::socket>;

   using Temporary = TemporaryTables<PendingRequestTable, TempResponseHandlerTable>;

   bool matches(psio::view<const HttpHeader> header, std::string_view h)
   {
      return std::ranges::equal(std::string_view{header.name()}, h, {}, ::tolower, ::tolower);
   }

   std::string_view getRootHost(std::string_view host)
   {
      static std::vector<std::string> hosts = to<XAdmin>().options().hosts;
      std::string_view                result;

      // Find the most specific host name that matches the request
      for (const auto& name : hosts)
      {
         if (host.ends_with(name) &&
             (host.size() == name.size() || host[host.size() - name.size() - 1] == '.'))
         {
            if (name.size() > result.size())
            {
               result = name;
            }
         }
      }
      using namespace std::literals::string_view_literals;
      // Special hostname that is not valid HTTP syntax, used by psinode
      // and psitest for internally generated requests that should
      // work even when there is no host name configured.
      if (result.empty() && host == "\0"sv || host.ends_with(".\0"sv))
         result = "\0"sv;
      // If there isn't a matching host, default to the first host
      if (result.empty() && !hosts.empty())
      {
         result = hosts.front();
      }
      return result;
   }

   std::string getUrl(psio::view<const HttpRequest> req,
                      std::int32_t                  socket,
                      std::string_view              rootHost,
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
      location += rootHost;
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

#ifndef PSIBASE_GENERATE_SCHEMA

extern "C" [[clang::export_name("recv")]] void recv()
{
   psibase::internal::receiver = XHttp::service;
   auto act                    = getCurrentActionView();

   auto [socket, data] =
       psio::view<const std::tuple<std::int32_t, std::vector<char>>>(act->rawData());
   // if this is a response to an HTTP request, send it to the owner
   auto                              requests = XHttp{}.open<ResponseHandlerTable>();
   std::optional<ResponseHandlerRow> row;
   bool                              accepted;
   PSIBASE_SUBJECTIVE_TX
   {
      row = requests.get(socket.unpack());
      if (row)
      {
         if (row->type == SocketType::http)
         {
            requests.remove(*row);
            check(socketSetFlags(socket, SocketFlags::autoClose | SocketFlags::notifyClose,
                                 SocketFlags::autoClose) == 0,
                  "Failed to set auto-close");
         }
         else if (row->type == SocketType::handshake)
         {
            auto sockets = Native::session(KvMode::read).open<SocketTable>();
            auto info    = sockets.get(socket.unpack());
            check(info.has_value(), "Missing SocketInfo for " + std::to_string(socket.unpack()));
            accepted = std::holds_alternative<WebSocketInfo>(info->info);
            if (accepted)
            {
               row->type = SocketType::websocket;
               requests.put(*row);
               row->type = SocketType::handshake;
            }
            else
            {
               requests.remove(*row);
               check(socketSetFlags(socket, SocketFlags::autoClose | SocketFlags::notifyClose,
                                    SocketFlags::autoClose) == 0,
                     "Failed to set auto-close");
            }
         }
      }
   }

   if (row)
   {
      if (row->type == SocketType::http)
      {
         call(Action{.sender  = XHttp::service,
                     .service = row->service,
                     .method  = row->method,
                     .rawData = psio::to_frac(
                         std::tuple(socket, psio::view<const psibase::HttpReply>(data)))});
      }
      else if (row->type == SocketType::handshake)
      {
         call(Action{.sender  = XHttp::service,
                     .service = row->service,
                     .method  = accepted ? row->method : row->err,
                     .rawData = psio::to_frac(std::tuple(
                         socket, std::optional(psio::view<const psibase::HttpReply>(data))))});
      }
      else
      {
         act->sender()  = XHttp::service;
         act->service() = row->service;
         act->method()  = row->method;
         psibase::call(act.data(), act.size());

         // It's safe to access this, because we still hold a closeLock
         check(socketSetFlags(socket, SocketFlags::recv, SocketFlags::recv) == 0,
               "Next recv failed");
      }
      return;
   }

   act->sender()  = XHttp::service;
   act->service() = HttpServer::service;
   act->method()  = MethodNumber{"recv"};
   psibase::call(act.data(), act.size());
}

extern "C" [[clang::export_name("close")]] void closeSocket()
{
   psibase::internal::receiver = XHttp::service;
   auto act                    = getCurrentActionView();

   auto [socket] = psio::view<const std::tuple<std::int32_t>>(act->rawData());
   // if this is a response to an HTTP request, send it to the owner
   auto                              requests = XHttp{}.open<ResponseHandlerTable>();
   std::optional<ResponseHandlerRow> row;
   PSIBASE_SUBJECTIVE_TX
   {
      row = requests.get(socket.unpack());
      if (row)
      {
         requests.remove(*row);
      }
   }

   if (row)
   {
      call(Action{.sender  = XHttp::service,
                  .service = row->service,
                  .method  = row->err,
                  .rawData = psio::to_frac(std::tuple(socket))});
      return;
   }

   act->sender()  = XHttp::service;
   act->service() = HttpServer::service;
   act->method()  = MethodNumber{"close"};
   psibase::call(act.data(), act.size());
}

#endif

void XHttp::send(std::int32_t socket, psio::view<const std::vector<char>> data)
{
   if (socket == producer_multicast)
   {
      check(getSender() == HttpServer::service, "Wrong sender");
   }
   else
   {
      auto                              requests = XHttp{}.open<ResponseHandlerTable>();
      std::optional<ResponseHandlerRow> row;
      PSIBASE_SUBJECTIVE_TX
      {
         row = requests.get(socket);
      }
      if (!row || row->service != getSender() || row->type != SocketType::websocket)
         abortMessage("Wrong sender");
   }
   check(psibase::socketSend(socket, data) == 0, "socketSend failed");
}

std::int32_t XHttp::sendRequest(HttpRequest                   request,
                                std::optional<TLSInfo>        tls,
                                std::optional<SocketEndpoint> endpoint)
{
   auto sender    = getSender();
   auto codeTable = Native::subjective(KvMode::read).open<CodeTable>();
   PSIBASE_SUBJECTIVE_TX
   {
      if (!codeTable.get(sender))
         abortMessage("Only local services can use sendRequest");
   }
   auto requests = Temporary{}.open<TempResponseHandlerTable>();
   auto sock     = socketOpen(request, tls, endpoint);
   check(sock >= 0, "Failed to open socket");
   PSIBASE_SUBJECTIVE_TX
   {
      requests.put({sock, SocketType::http, sender});
   }
   return sock;
}

std::int32_t XHttp::websocket(HttpRequest                   request,
                              std::optional<TLSInfo>        tls,
                              std::optional<SocketEndpoint> endpoint)
{
   auto sender    = getSender();
   auto codeTable = Native::subjective(KvMode::read).open<CodeTable>();
   if (!request.getHeader("connection"))
   {
      request.headers.push_back({"Connection", "Upgrade"});
   }
   if (!request.getHeader("upgrade"))
   {
      request.headers.push_back({"Upgrade", "websocket"});
   }
   if (!request.getHeader("Sec-WebSocket-Key"))
   {
      request.headers.push_back({"Sec-WebSocket-Key", randomWebSocketKey()});
   }
   PSIBASE_SUBJECTIVE_TX
   {
      if (!codeTable.get(sender))
         abortMessage("Only local services can use sendRequest");
   }
   auto requests = Temporary{}.open<TempResponseHandlerTable>();
   auto sock     = socketOpen(request, tls, endpoint);
   check(sock >= 0, "Failed to open socket");
   PSIBASE_SUBJECTIVE_TX
   {
      requests.put({sock, SocketType::handshake, sender});
   }
   return sock;
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
      auto mask = SocketFlags::autoClose | SocketFlags::lockClose;
      check(socketSetFlags(socket, mask, value ? mask : SocketFlags{}) == 0,
            "Failed to change auto-close");
   }
}

void XHttp::close(std::int32_t socket)
{
   auto sender   = getSender();
   auto requests = Session{}.open<ResponseHandlerTable>();
   PSIBASE_SUBJECTIVE_TX
   {
      auto row = requests.get(socket);
      if (!row || row->service != sender)
         abortMessage(sender.str() + " cannot close socket " + std::to_string(socket));
      requests.remove(*row);
      check(socketSetFlags(socket, SocketFlags::autoClose, SocketFlags::autoClose) == 0,
            "Failed to set auto-close");
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
   check(socketSend(socket, psio::to_frac(result)) == 0, "socketSend failed");
   PSIBASE_SUBJECTIVE_TX
   {
      check(socketSetFlags(socket, SocketFlags::lockClose, SocketFlags{}) == 0,
            "Failed to set auto-close");
   }
}

void XHttp::accept(std::int32_t socket, const psibase::HttpReply& reply)
{
   auto sender   = getSender();
   auto owned    = Temporary{}.open<PendingRequestTable>();
   auto handlers = Temporary{}.open<TempResponseHandlerTable>();

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

   PSIBASE_SUBJECTIVE_TX
   {
      handlers.put({.socket = socket, .type = SocketType::websocket, .service = sender});
   }
   socketSend(socket, psio::to_frac(reply));
}

void XHttp::setCallback(std::int32_t          socket,
                        psibase::MethodNumber callback,
                        psibase::MethodNumber err)
{
   auto sender   = getSender();
   auto requests = Session{}.open<ResponseHandlerTable>();
   PSIBASE_SUBJECTIVE_TX
   {
      auto row = requests.get(socket);
      if (row)
      {
         check(socketSetFlags(socket, SocketFlags::recv, SocketFlags::recv) == 0,
               "Failed to start recv");
      }
      else
      {
         auto temp = Temporary{}.open<TempResponseHandlerTable>();
         if (auto tempRow = temp.get(socket))
         {
            row = {tempRow->socket, tempRow->type, tempRow->service, callback, err};
            temp.remove(*tempRow);
            check(socketSetFlags(socket,
                                 SocketFlags::autoClose | SocketFlags::notifyClose |
                                     SocketFlags::lockClose | SocketFlags::recv,
                                 SocketFlags::notifyClose | SocketFlags::recv) == 0,
                  "Failed to disable auto-close");
         }
      }
      if (!row || row->service != sender)
         abortMessage(sender.str() + " does not own socket " + std::to_string(socket));
      row->method = callback;
      row->err    = err;
      requests.put(*row);
   }
}

std::string XHttp::rootHost(psio::view<const std::string> host)
{
   return std::string(getRootHost(host));
}

void XHttp::startSession()
{
   check(getSender() == AccountNumber{}, "Wrong sender");
   to<XAdmin>().startSession();
}

#ifndef PSIBASE_GENERATE_SCHEMA

extern "C" [[clang::export_name("serve")]] void serve()
{
   auto act                    = getCurrentActionView();
   psibase::internal::receiver = XHttp::service;

   auto [sockview, req] = psio::view<const std::tuple<std::int32_t, HttpRequest>>(act->rawData());
   auto sock            = sockview.unpack();

   auto owned    = Temporary{act->service(), KvMode::readWrite}.open<PendingRequestTable>();
   auto rootHost = getRootHost(req.host());

   if (rootHost.empty())
   {
      sendNotFound(sock, req);
      return;
   }

   if (auto service = XHttp::getService(req.host(), rootHost); service != AccountNumber{})
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
   else if (rootHost != req.host() && std::string_view{req.target()} != "/native/p2p")
   {
      if (!rootHost.empty())
      {
         std::string location = getUrl(req, sock, rootHost);
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
         std::string location = getUrl(req, sock, rootHost, XAdmin::service);
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
