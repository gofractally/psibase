#include <services/local/XHttp.hpp>

#include <psibase/HttpHeaders.hpp>
#include <psibase/WebSocket.hpp>
#include <psibase/dispatch.hpp>
#include <psibase/webServices.hpp>
#include <services/local/XAdmin.hpp>
#include <services/local/XDb.hpp>
#include <services/local/XSites.hpp>
#include <services/system/RTransact.hpp>

using namespace psibase;
using namespace LocalService;
using namespace SystemService;

namespace
{
   struct TempPendingRequestRow
   {
      std::int32_t                              socket;
      psibase::AccountNumber                    owner;
      std::optional<std::vector<AccountNumber>> prevOwners;
      PSIO_REFLECT(TempPendingRequestRow, socket, owner, prevOwners)
   };
   using TempPendingRequestTable =
       psibase::Table<TempPendingRequestRow, &TempPendingRequestRow::socket>;

   // This is used to store outgoing HTTP requests before their callbacks are set.
   struct TempResponseHandlerRow
   {
      std::int32_t           socket;
      SocketType             type;
      psibase::AccountNumber service;
   };
   PSIO_REFLECT(TempResponseHandlerRow, socket, type, service)
   using TempResponseHandlerTable = Table<TempResponseHandlerRow, &TempResponseHandlerRow::socket>;

   using Temporary = TemporaryTables<TempPendingRequestTable, TempResponseHandlerTable>;

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

   bool hasTls(const SocketInfo& info)
   {
      return std::visit(
          [](const auto& i) -> bool
          {
             if constexpr (requires { i.tls; })
                return i.tls.has_value();
             else
                return false;
          },
          info);
   }

   std::string getUrl(const HttpRequestRef&       req,
                      std::int32_t                 socket,
                      std::string_view             rootHost,
                      std::optional<AccountNumber> subdomain = {})
   {
      std::string location;
      // A read needs no section: outside one it is a read of what was
      // published last and takes no lock (gofractally/psibase#2276).
      auto socketRow = Native::session(KvMode::read).open<SocketTable>().get(socket);
      if (auto proto = forwardedProto(req))
         location += *proto + "://";
      else if (hasTls(socketRow.value().info))
         location += "https://";
      else
         location += "http://";
      if (subdomain)
      {
         location += subdomain->str();
         location += '.';
      }
      location += rootHost;
      if (auto host = req.getHeader("host"))
      {
         if (auto pos = host->rfind(':'); pos != std::string::npos)
         {
            if (host->find(']', pos) == std::string::npos)
            {
               location.append(host->substr(pos));
            }
         }
      }
      if (subdomain)
         location += '/';
      else
         location += req.target;
      return location;
   }

   void checkResponseHeaders(const TempPendingRequestRow& row, const HttpReply& reply)
   {
      if (row.owner == HttpServer::service ||
          row.prevOwners && std::ranges::contains(*row.prevOwners, HttpServer::service))
      {
         for (const HttpHeader& header : reply.headers)
         {
            if (header.matches("set-cookie"))
            {
               // A chain service may set cookies for its own host only, with
               // one exception: the network-wide cookie that says who to
               // bill. It is no use to an app that sets it: it is honoured
               // only if it holds a session token this node issued, apps
               // never see such tokens, and nothing treats it as the user
               // speaking.
               check(header.value.starts_with("__Host-") ||
                         header.value.starts_with("__Secure-VISITOR="),
                     "Only __Host- cookies are allowed");
            }
         }
      }
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

   void sendNotFound(std::int32_t sock, const HttpRequestRef& req)
   {
      auto reply = error(HttpStatus::notFound, "The resource '" + req.target + "' was not found");
      psibase::socketSend(sock, psio::to_pssz(std::move(reply)));
   }

   bool chainIsBooted()
   {
      auto mode   = KvMode::read;
      auto prefix = std::span<const char>();
      auto native = Native::Tables{to<XDb>().open(DbId::native, prefix, mode), mode};
      auto row    = native.open<StatusTable>().get({});
      return row && row->head;
   }

   // Usage metering (gofractally/psibase#2270): a request with a valid
   // login token is charged to the account it names, not to the client's
   // address. Native resolves the address; the token can only be checked
   // here, by the transaction service that issued it. A request without
   // credentials pays nothing for this; one with credentials pays one
   // call. The result is handed to native as a SocketIdentityRow, which
   // native consumes without storing anything.
   //
   // This is done by x-http, the node's own service, and not by
   // http-server, which resolves the user again for the requests it
   // routes: http-server is a chain service, the same on every node, and
   // must not depend on what one node's local services provide.
   void identifyUser(std::int32_t sock, const HttpRequestRef& req)
   {
      if (!req.getHeader("authorization") && req.getCookie("__Host-SESSION").empty())
         return;
      if (!chainIsBooted())
         return;
      HttpRequest credentials{.host        = req.host,
                              .method      = req.method,
                              .target      = req.target,
                              .contentType = req.contentType,
                              .headers     = req.headers};
      if (auto user = to<RTransact>().getUser(std::move(credentials)))
      {
         Native::sessionDirect(KvMode::readWrite)
             .open<SocketIdentityTable>()
             .put(SocketIdentityRow{sock, *user});
      }
   }
}  // namespace

#ifndef PSIBASE_GENERATE_SCHEMA

extern "C" [[clang::export_name("recv")]] void recv()
{
   psibase::internal::receiver = XHttp::service;
   auto act                    = getCurrentActionPacked();

   using Args = std::tuple<std::int32_t, std::vector<char>, std::uint32_t>;
   std::span<const char> args = act->rawData();
   check(psio::validate_pssz<Args>(args).ok(), "invalid arguments of recv");
   auto [socket, data, flags] = psio::pssz_view<Args>(args);
   // Forwards the action as it is, to another service
   auto forward = [&act](AccountNumber service, MethodNumber method)
   {
      auto action      = psio::as_mutable_view(act);
      action.sender()  = XHttp::service;
      action.service() = service;
      action.method()  = method;
      psibase::call(act.data(), act.size());
   };
   // if this is a response to an HTTP request, send it to the owner
   auto                              requests = XHttp{}.open<ResponseHandlerTable>();
   std::optional<ResponseHandlerRow> row;
   bool                              accepted;
   PSIBASE_SUBJECTIVE_TX
   {
      row = requests.get(socket);
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
            auto info    = sockets.get(socket);
            check(info.has_value(), "Missing SocketInfo for " + std::to_string(socket));
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

   // The data of an HTTP socket is a packed HttpReply
   auto replyView = [&]
   {
      std::span<const char> reply = data;
      check(psio::validate_pssz<psibase::HttpReply>(reply).ok(), "invalid HttpReply");
      return psio::pssz_view<psibase::HttpReply>(reply);
   };

   if (row)
   {
      if (row->type == SocketType::http)
      {
         call(Action{.sender  = XHttp::service,
                     .service = row->service,
                     .method  = row->method,
                     .rawData = psio::to_pssz(std::tuple(socket, replyView()))});
      }
      else if (row->type == SocketType::handshake)
      {
         call(Action{.sender  = XHttp::service,
                     .service = row->service,
                     .method  = accepted ? row->method : row->err,
                     .rawData = psio::to_pssz(std::tuple(socket, std::optional(replyView())))});
      }
      else
      {
         forward(row->service, row->method);

         // It's safe to access this, because we still hold a closeLock
         check(socketSetFlags(socket, SocketFlags::recv, SocketFlags::recv) == 0,
               "Next recv failed");
      }
      return;
   }

   forward(HttpServer::service, MethodNumber{"recv"});
}

extern "C" [[clang::export_name("close")]] void closeSocket()
{
   psibase::internal::receiver = XHttp::service;
   auto act                    = getCurrentActionPacked();

   std::span<const char> args = act->rawData();
   check(psio::validate_pssz<std::tuple<std::int32_t>>(args).ok(), "invalid arguments of close");
   auto [socket] = psio::pssz_view<std::tuple<std::int32_t>>(args);
   // if this is a response to an HTTP request, send it to the owner
   auto requests = XHttp{}.open<ResponseHandlerTable>();
   auto row      = requests.get(socket);

   if (row)
   {
      // The error callback of a request or handshake takes the reply, if
      // there is one, and declares maxDynamicData(0xffffffff): 4-byte
      // offsets, which (socket, no reply) has here. The close callback of
      // a websocket takes the socket alone, without a cap: 1-byte offsets.
      // The two argument lists are different encodings.
      call(Action{.sender  = XHttp::service,
                  .service = row->service,
                  .method  = row->err,
                  .rawData = row->type == SocketType::websocket
                                 ? psio::to_pssz(std::tuple(socket))
                                 : psio::to_pssz(std::tuple(
                                       socket, std::optional<psibase::HttpReply>{}))});

      PSIBASE_SUBJECTIVE_TX
      {
         requests.remove(*row);
      }
      return;
   }

   auto action      = psio::as_mutable_view(act);
   action.sender()  = XHttp::service;
   action.service() = HttpServer::service;
   action.method()  = MethodNumber{"close"};
   psibase::call(act.data(), act.size());
}

#endif

void XHttp::send(std::int32_t socket, psio::pssz_view<std::vector<char>> data, std::uint32_t flags)
{
   if (socket == producer_multicast)
   {
      check(getSender() == HttpServer::service, "Wrong sender");
   }
   else
   {
      auto requests = XHttp{}.open<ResponseHandlerTable>();
      auto row      = requests.get(socket);
      if (!row || row->service != getSender() || row->type != SocketType::websocket)
         abortMessage("Wrong sender");
   }
   check(psibase::socketSend(socket, data, flags) == 0, "socketSend failed");
}

std::int32_t XHttp::sendRequest(HttpRequest                   request,
                                std::optional<TLSInfo>        tls,
                                std::optional<SocketEndpoint> endpoint)
{
   auto sender    = getSender();
   auto codeTable = Native::subjective(KvMode::read).open<CodeTable>();
   if (!codeTable.get(sender))
      abortMessage("Only local services can use sendRequest");
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
   if (!request.getHeader("Sec-WebSocket-Version"))
   {
      request.headers.push_back({"Sec-WebSocket-Version", "13"});
   }
   if (!codeTable.get(sender))
      abortMessage("Only local services can use sendRequest");
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
      // A request that closes automatically is in the temporary table, any
      // other in the session table. The temporary row may also hold
      // prevOwners, which is dropped when the request moves. (The two row
      // types are read as themselves: a row with known members of fixed
      // size only cannot be read from the bytes of the wider one.)
      auto requests = Session{}.open<PendingRequestTable>();
      auto owned    = Temporary{}.open<TempPendingRequestTable>();
      auto denied   = [&]
      {
         abortMessage(sender.str() + " cannot send a response on socket " +
                      std::to_string(socket));
      };
      if (value)
      {
         if (auto row = requests.get(socket); row && row->owner == sender)
         {
            requests.remove(*row);
            owned.put({.socket = row->socket, .owner = row->owner});
         }
         else if (auto row = owned.get(socket); !row || row->owner != sender)
            denied();
      }
      else
      {
         if (auto row = owned.get(socket); row && row->owner == sender)
         {
            owned.remove(*row);
            requests.put({.socket = row->socket, .owner = row->owner});
         }
         else if (auto row = requests.get(socket); !row || row->owner != sender)
            denied();
      }
      auto mask = SocketFlags::autoClose | SocketFlags::lockClose;
      check(socketSetFlags(socket, mask, value ? mask : SocketFlags{}) == 0,
            "Failed to change auto-close");
   }
}

void XHttp::asyncClose(std::int32_t socket)
{
   auto sender   = getSender();
   auto requests = Session{}.open<ResponseHandlerTable>();
   PSIBASE_SUBJECTIVE_TX
   {
      auto row = requests.get(socket);
      if (!row || row->service != sender)
         abortMessage(sender.str() + " cannot close socket " + std::to_string(socket));
      auto flags = SocketFlags::autoClose | SocketFlags::notifyClose;
      // Ignore errors. This can fail if the socket is already closing.
      socketSetFlags(socket, flags, flags);
   }
}

namespace
{
   // Sends a node-local service's reply. A reply that carries the send-file
   // header has no body of its own: the header names one of the service's
   // files in the node's file store and the part of it to send, and the node
   // sends those bytes itself. Only replies of local services come through
   // here; a chain service cannot ask for a file.
   void sendLocalReply(std::int32_t sock, AccountNumber service, HttpReply&& reply)
   {
      auto pos = std::ranges::find_if(reply.headers,
                                      [](const HttpHeader& h) { return h.matches(sendFileHeader); });
      if (pos == reply.headers.end())
      {
         psibase::socketSend(sock, psio::to_pssz(std::move(reply)));
         return;
      }
      // "<name>;<offset>;<length>"
      std::string_view value  = pos->value;
      auto             first  = value.find(';');
      auto             second = first == std::string_view::npos ? first : value.find(';', first + 1);
      check(second != std::string_view::npos, "malformed send-file header");
      auto number = [](std::string_view text)
      {
         std::uint64_t result = 0;
         check(!text.empty() && text.size() <= 19, "malformed send-file header");
         for (char ch : text)
         {
            check(ch >= '0' && ch <= '9', "malformed send-file header");
            result = result * 10 + static_cast<std::uint64_t>(ch - '0');
         }
         return result;
      };
      HttpFileReply file{.service = service,
                         .file    = std::string{value.substr(0, first)},
                         .offset  = number(value.substr(first + 1, second - first - 1)),
                         .length  = number(value.substr(second + 1))};
      reply.headers.erase(pos);
      reply.body.clear();
      file.reply = std::move(reply);
      psibase::socketSend(sock, psio::to_pssz(std::move(file)), sendFileFlag);
   }
}  // namespace

void XHttp::sendReply(std::int32_t socket, const HttpReply& result)
{
   auto sender = getSender();
   auto owned  = Temporary{}.open<TempPendingRequestTable>();
   if (auto row = owned.get(socket))
   {
      if (row->owner != sender)
      {
         abortMessage(sender.str() + " cannot send a response on socket " + std::to_string(socket));
      }
      checkResponseHeaders(*row, result);
      owned.remove(*row);
   }
   else
   {
      abortMessage("Must set autoClose before sending a response");
   }
   check(socketSend(socket, psio::to_pssz(result)) == 0, "socketSend failed");
   PSIBASE_SUBJECTIVE_TX
   {
      check(socketSetFlags(socket, SocketFlags::lockClose, SocketFlags{}) == 0,
            "Failed to set auto-close");
   }
}

void XHttp::giveSocket(std::int32_t socket, AccountNumber service, bool local)
{
   auto sender = getSender();
   auto owned  = Temporary{}.open<TempPendingRequestTable>();

   auto row = owned.get(socket);
   if (!row || row->owner != sender)
      abortMessage(std::format("{} does not own socket {}", sender.str(), socket));
   if (!row->prevOwners)
      row->prevOwners.emplace();
   row->prevOwners->push_back(sender);
   if (std::ranges::contains(*row->prevOwners, service))
      abortMessage("recursive transfer of socket");

   // If service is a chain service, the response will be
   // routed through http-server
   if (!local)
   {
      row->owner = HttpServer::service;
      owned.put(*row);
      to<HttpServer>().giveSocket(socket, service);
   }
   else
   {
      row->owner = service;
      owned.put(*row);
   }
}

bool XHttp::takeSocket(std::int32_t socket, bool local)
{
   auto sender = getSender();
   auto owned  = Temporary{}.open<TempPendingRequestTable>();
   auto row    = owned.get(socket);

   if (!row || !row->prevOwners)
      return false;

   auto pos = std::ranges::find(*row->prevOwners, sender);
   if (pos == row->prevOwners->end())
      return false;

   if (local)
   {
      if (!to<HttpServer>().takeSocket(socket))
         abortMessage("http-server::takeSocket failed");
   }

   row->prevOwners->erase(pos, row->prevOwners->end());
   if (row->prevOwners->empty())
      row->prevOwners.reset();
   row->owner = sender;
   owned.put(*row);
   return true;
}

void XHttp::accept(std::int32_t socket, const psibase::HttpReply& reply)
{
   auto sender   = getSender();
   auto owned    = Temporary{}.open<TempPendingRequestTable>();
   auto handlers = Temporary{}.open<TempResponseHandlerTable>();

   if (auto row = owned.get(socket))
   {
      if (row->owner != sender)
      {
         abortMessage(sender.str() + " cannot send a response on socket " + std::to_string(socket));
      }
      checkResponseHeaders(*row, reply);
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
   socketSend(socket, psio::to_pssz(reply));
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

void XHttp::log(LogMessage::Severity severity, std::string msg)
{
   socketSend(SocketRow::log,
              psio::to_pssz(LogMessage{
                  .message = std::move(msg), .severity = severity, .service = getSender()}));
}

std::string XHttp::rootHost(psio::pssz_view<std::string> host)
{
   return std::string(getRootHost(host));
}

void XHttp::startSession()
{
   check(getSender() == AccountNumber{}, "Wrong sender");
   recurse().to<XAdmin>().startSession();
}

bool XHttp::isSecure(int32_t socket)
{
   auto sender   = getSender();
   auto receiver = getReceiver();

   auto ownedBySender = [&](auto table, auto field)
   {
      if (auto row = table.get(socket))
         return (*row).*field == sender;
      return false;
   };

   // Lookups only, so no section. The rows need not be read as of one
   // moment: a socket's row in the socket table does not change while the
   // socket is open, and its place in the four tables is changed only on
   // behalf of its owner, which is the caller.
   auto session = Session{receiver, KvMode::read};
   auto temp    = Temporary{receiver, KvMode::read};
   if (!ownedBySender(session.open<PendingRequestTable>(), &PendingRequestRow::owner) &&
       !ownedBySender(temp.open<TempPendingRequestTable>(), &TempPendingRequestRow::owner) &&
       !ownedBySender(session.open<ResponseHandlerTable>(), &ResponseHandlerRow::service) &&
       !ownedBySender(temp.open<TempResponseHandlerTable>(), &TempResponseHandlerRow::service))
      abortMessage(sender.str() + " does not own socket " + std::to_string(socket));

   auto socketRow = Native::session(KvMode::read).open<SocketTable>().get(socket);

   return hasTls(socketRow.value().info);
}

auto XHttp::serveSys(HttpRequest request, std::optional<std::int32_t> socket)
    -> std::optional<HttpReply>
{
   check(getSender() == XHttp::service, "Wrong sender");

   // Deciding that a caller is not a local administrator asks the chain who
   // they are, and the chain's services ask this one for the root host: the
   // check comes back into x-http, so it is made as a recursive call. Without
   // that a refused request ended in "Cannot reenter service" (a 500, with
   // nothing done) instead of the 401.
   if (auto reply = recurse().to<XAdmin>().checkAuth(request, socket))
      return reply;

   if (request.method == "OPTIONS")
      return HttpReply{.headers = allowCors(request, {XAdmin::service, AccountNumber{"x-proxy"}})};

   auto target = request.path();
   if (target == "/register_server")
   {
      if (request.method != "POST")
         return HttpReply::methodNotAllowed(request);

      if (request.contentType != "application/json")
         return error(HttpStatus::unsupportedMediaType, "Content-Type must be application/json");

      auto body = psio::from_ijson<RegisteredServiceRow>(request.body);
      PSIBASE_SUBJECTIVE_TX
      {
         open<RegServTable>().put(body);
      }
      return HttpReply{.headers = allowCors(request, {XAdmin::service, AccountNumber{"x-proxy"}})};
   }

   if (target == "/identity_gate")
   {
      auto headers = allowCors(request, {XAdmin::service});
      if (request.method == "PUT")
      {
         if (request.contentType != "application/json")
            return error(HttpStatus::unsupportedMediaType,
                         "Content-Type must be application/json");
         auto body = psio::from_ijson<IdentityGateRow>(request.body);
         PSIBASE_SUBJECTIVE_TX
         {
            open<IdentityGateTable>().put(body);
         }
         return HttpReply{.headers = std::move(headers)};
      }
      if (request.method != "GET")
         return HttpReply::methodNotAllowed(request);
      IdentityGateRow row;
      PSIBASE_SUBJECTIVE_TX
      {
         row = open<IdentityGateTable>().get({}).value_or(IdentityGateRow{});
      }
      HttpReply reply{.contentType = "application/json", .headers = std::move(headers)};
      psio::to_ijson(row, reply.body);
      return reply;
   }

   if (target == "/transport_policy")
   {
      auto headers = allowCors(request, {XAdmin::service});
      if (request.method == "PUT")
      {
         if (request.contentType != "application/json")
            return error(HttpStatus::unsupportedMediaType,
                         "Content-Type must be application/json");
         auto body = psio::from_ijson<TransportPolicyRow>(request.body);
         PSIBASE_SUBJECTIVE_TX
         {
            open<TransportPolicyTable>().put(body);
         }
         return HttpReply{.headers = std::move(headers)};
      }
      if (request.method != "GET")
         return HttpReply::methodNotAllowed(request);
      TransportPolicyRow row;
      PSIBASE_SUBJECTIVE_TX
      {
         row = open<TransportPolicyTable>().get({}).value_or(TransportPolicyRow{});
      }
      HttpReply reply{.contentType = "application/json", .headers = std::move(headers)};
      psio::to_ijson(row, reply.body);
      return reply;
   }

   if (target == "/unregister_server")
   {
      if (request.method != "POST")
         return HttpReply::methodNotAllowed(request);

      if (request.contentType != "application/json")
         return error(HttpStatus::unsupportedMediaType, "Content-Type must be application/json");

      auto service = psio::from_ijson<AccountNumber>(request.body);
      PSIBASE_SUBJECTIVE_TX
      {
         auto serverTable = open<RegServTable>();
         if (!serverTable.get(service))
            return error(HttpStatus::notFound, "Service is not registered");
         serverTable.erase(service);
      }
      return HttpReply{.headers = allowCors(request, {XAdmin::service, AccountNumber{"x-proxy"}})};
   }

   return {};
}

#ifndef PSIBASE_GENERATE_SCHEMA

namespace
{
   // True when a request must be refused because it did not come over TLS.
   //
   // A request is acceptable when any of these holds:
   // - the connection is TLS;
   // - a proxy says the client used https (X-Forwarded-Proto / Forwarded);
   // - a proxy forwarded it without saying which: the node cannot tell, and
   //   refusing would lock out a correctly secured site whose proxy omits
   //   the header, so the proxy is trusted to enforce https itself;
   // - it is a direct local connection (loopback, a Unix socket or an admin
   //   address): node administration and tools on the same machine;
   // - the node's host is a localhost name, where browsers treat plain http
   //   as a secure context.
   bool insecureTransport(std::int32_t sock, const HttpRequestRef& req, std::string_view rootHost)
   {
      bool required = true;
      PSIBASE_SUBJECTIVE_TX
      {
         required = XHttp{}
                        .open<TransportPolicyTable>()
                        .get({})
                        .value_or(TransportPolicyRow{})
                        .requireHttps;
      }
      if (!required)
         return false;
      // Read directly: isSecure() is for services that own the socket, and
      // nobody owns it yet.
      {
         std::optional<SocketRow> row;
         PSIBASE_SUBJECTIVE_TX
         {
            row = Native::session(KvMode::read).open<SocketTable>().get(sock);
         }
         if (row && hasTls(row->info))
            return false;
      }

      auto bare = rootHost.substr(0, rootHost.find(':'));
      if (bare == "localhost" || bare.ends_with(".localhost"))
         return false;

      bool forwarded = false;
      for (const auto& header : req.headers)
      {
         if (header.matches("x-forwarded-proto"))
            return !iequal(header.value, "https");
         if (header.matches("forwarded"))
         {
            std::string lower;
            for (char c : header.value)
               lower += static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
            if (lower.find("proto=https") != std::string::npos)
               return false;
            if (lower.find("proto=http") != std::string::npos)
               return true;
            forwarded = true;
         }
         else if (header.matches("x-forwarded-for"))
            forwarded = true;
      }
      if (forwarded)
         return false;

      return !to<XAdmin>().isAdmin(std::optional<AccountNumber>{},
                                   std::optional<std::int32_t>{sock},
                                   std::vector<std::optional<IPAddress>>{});
   }
}  // namespace

extern "C" [[clang::export_name("serve")]] void serve()
{
   auto act                    = getCurrentActionView();
   psibase::internal::receiver = act->service();

   auto [sock, req] = psio::from_pssz<std::tuple<std::int32_t, HttpRequestRef>>(act->rawData());

   auto owned    = Temporary{getReceiver(), KvMode::readWrite}.open<TempPendingRequestTable>();
   auto rootHost = getRootHost(req.host);

   if (rootHost.empty())
   {
      sendNotFound(sock, req);
      return;
   }

   if (insecureTransport(sock, req, rootHost))
   {
      // The redirect goes to the default https port: the request's host
      // carries no port, and the node cannot know where a proxy listens.
      bool canRedirect = req.method == "GET" || req.method == "HEAD";
      auto reply = canRedirect
                       ? redirect(HttpStatus::permanentRedirect,
                                  R"(<html><body>This server requires a secure connection: {}</body></html>)",
                                  "https://" + req.host + req.target)
                       : error(HttpStatus::forbidden,
                               "<html><body>This server requires a secure (https) "
                               "connection.</body></html>");
      psibase::socketSend(sock, psio::to_pssz(std::move(reply)));
      return;
   }

   identifyUser(sock, req);

   if (auto service = XHttp::getService(req.host, rootHost); service != AccountNumber{})
   {
      auto codeTable   = Native::subjective(KvMode::read).open<CodeTable>();
      auto serverTable = XHttp{}.open<RegServTable>();
      // Two lookups on every request, without a section (which would
      // wait for every writer). The rows are written by different
      // requests (register_server; the installation of a service) and
      // need not be read as of one moment.
      std::optional<RegisteredServiceRow> server = serverTable.get(service);
      std::optional<CodeRow>              code   = codeTable.get(service);
      // Required for bootstrapping
      if (!server && service == XHttp::service)
         server = {service, service};

      std::optional<HttpReply> reply;
      // The local service whose reply this is: a reply may ask for one of
      // that service's own files to be sent as its body.
      AccountNumber replier;

      // Handle registered servers
      if (server)
      {
         auto service =
             (req.target.starts_with(XHttp::commonPrefix) ? XHttp::commonService : server->server);
         owned.put({.socket = sock, .owner = service});
         replier = service;
         reply = psibase::Actor<ServerInterface>(XHttp::service, service)
                     .serveSys(req, std::optional{sock}, std::nullopt);
         if (!owned.get(sock))
            return;
      }
      // Local services try x-sites
      if (!reply && code && !(code->flags & CodeRow::isReplacement))
      {
         if (service == XAdmin::service && std::string_view{req.target}.starts_with("/native/"))
         {
            return;
         }
         code = codeTable.get(XSites::service);
         if (code)
         {
            owned.put({.socket = sock, .owner = XSites::service});
            replier = XSites::service;
            reply = psibase::Actor<ServerInterface>(XHttp::service, XSites::service)
                        .serveSys(req, std::optional{sock}, std::nullopt);

            if (!owned.get(sock))
               return;
         }

         if (!reply)
         {
            sendNotFound(sock, req);
            return;
         }
      }
      if (reply)
      {
         sendLocalReply(sock, replier, std::move(*reply));
         return;
      }
   }
   else if (rootHost != req.host)
   {
      if (!rootHost.empty())
      {
         std::string location = getUrl(req, sock, rootHost);
         auto reply = redirect(HttpStatus::found,
                               R"(<html><body>This psibase server is hosted at {}.</body></html>)",
                               location);
         psibase::socketSend(sock, psio::to_pssz(std::move(reply)));
      }
      else
      {
         sendNotFound(sock, req);
      }
      return;
   }

   if (std::string_view{req.target}.starts_with("/native/"))
   {
      sendNotFound(sock, req);
      return;
   }

   if (!chainIsBooted())
   {
      if (req.method == "GET" || req.method == "HEAD")
      {
         std::string location = getUrl(req, sock, rootHost, XAdmin::service);
         auto        reply    = redirect(
             HttpStatus::found,
             R"(<html><body>Node is not connected to any psibase network.  Visit {} for node setup.</body></html>)",
             location);
         psibase::socketSend(sock, psio::to_pssz(std::move(reply)));
      }
      else
      {
         auto reply =
             error(HttpStatus::serviceUnavailable,
                   "<html><body>Node is not connected to any psibase network.</body></html>");
         psibase::socketSend(sock, psio::to_pssz(std::move(reply)));
      }
      return;
   }

   // Forward other requests to HttpServer
   // __Secure-VISITOR says who to bill; the chain's HTTP service reads it
   // and removes it before any app sees the request.
   req.removeCookies([](std::string_view name)
                     { return !name.starts_with("__Host-") && name != "__Secure-VISITOR"; });

   // Decide whether this request must be identified before app code runs.
   // Only this service can see the connection, so it makes the decision and
   // the chain's HTTP service applies it.
   bool requireIdentity = false;
   PSIBASE_SUBJECTIVE_TX
   {
      requireIdentity = XHttp{}
                            .open<IdentityGateTable>()
                            .get({})
                            .value_or(IdentityGateRow{})
                            .required;
   }
   bool bypassRequested = false;
   bool forwarded       = false;
   for (const auto& header : req.headers)
   {
      if (header.matches(XHttp::localBypassHeader))
         bypassRequested = true;
      else if (header.matches("forwarded") || header.matches("x-forwarded-for"))
         forwarded = true;
   }
   if (bypassRequested)
   {
      std::erase_if(req.headers,
                    [](const auto& header) { return header.matches(XHttp::localBypassHeader); });
      // A proxy on this machine makes every client look local, so a
      // forwarded request never qualifies.
      if (requireIdentity && !forwarded && to<XAdmin>().isAdmin(std::optional<AccountNumber>{}, std::optional<std::int32_t>{sock},
                                      std::vector<std::optional<IPAddress>>{}))
         requireIdentity = false;
   }

   std::erase_if(req.headers,
                 [](const auto& header) { return header.matches(XHttp::gateHeader); });
   if (requireIdentity)
      req.headers.push_back({XHttp::gateHeader, "1"});

   owned.put({.socket = sock, .owner = HttpServer::service});
   to<HttpServer>().serve(sock, req);
}  // serve()

#endif

PSIBASE_DISPATCH(XHttp)
