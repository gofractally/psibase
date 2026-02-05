#include <services/local/XPeers.hpp>

#include <psibase/WebSocket.hpp>
#include <psibase/dispatch.hpp>
#include <services/local/XAdmin.hpp>
#include <services/local/XHttp.hpp>
#include <services/local/XTimer.hpp>

using namespace psibase;
using namespace LocalService;

namespace
{
   struct ConnectRequest
   {
      std::string url;
      PSIO_REFLECT(ConnectRequest, url)
   };

   struct DisconnectRequest
   {
      std::int32_t socket;
      PSIO_REFLECT(DisconnectRequest, socket)
   };

   constexpr MicroSeconds timeoutBase  = std::chrono::seconds(30);
   constexpr MicroSeconds timeoutDelta = std::chrono::seconds(30);
   constexpr MicroSeconds timeoutMax   = std::chrono::seconds(300);

   void addUrl(const std::string& url)
   {
      auto urls      = XPeers{}.open<UrlTable>();
      auto urlTimers = XPeers{}.open<UrlTimerTable>();
      auto row       = urls.get(url);
      if (!row)
         row = {url, 0, false, timeoutBase, MonotonicTimePointUSec::min(), std::nullopt};
      if (row->timerId)
      {
         to<XTimer>().cancel(*row->timerId);
         urlTimers.erase(*row->timerId);
         row->timerId.reset();
      }
      ++row->refcount;
      check(row->refcount != 0, "Integer overflow");
      urls.put(*row);
   }

   bool removeUrl(UrlTable& urls, UrlTimerTable& urlTimers, const std::string& url)
   {
      auto row = urls.get(url).value();
      check(!row.timerId, "Timer should not be running when the url is connected");
      if (--row.refcount == 0)
      {
         if (!row.autoconnect)
         {
            urls.remove(row);
         }
         else
         {
            auto now = std::chrono::time_point_cast<MicroSeconds>(std::chrono::steady_clock::now());
            if (now < row.retryTime)
            {
               auto id = to<XTimer>().runAt(row.retryTime, MethodNumber{"onTimer"});
               urlTimers.put({id, url});
               row.timerId = id;
               urls.put(row);
            }
            else
            {
               row.currentTimeout = timeoutBase;
               row.retryTime      = now + row.currentTimeout;
               urls.put(row);
               return true;
            }
         }
      }
      else
      {
         urls.put(row);
      }
      return false;
   }

   std::vector<std::string> removeUrls(std::vector<std::string>&& urls)
   {
      auto table  = XPeers{}.open<UrlTable>();
      auto timers = XPeers{}.open<UrlTimerTable>();
      PSIBASE_SUBJECTIVE_TX
      {
         std::erase_if(urls,
                       [&](const std::string& url) { return !removeUrl(table, timers, url); });
      }
      return std::move(urls);
   }

   std::int32_t connect(std::string peer, std::optional<std::int32_t> requestSocket = std::nullopt)
   {
      if (peer.find('/') == std::string::npos)
         peer = "http://" + peer;
      std::optional<TLSInfo>        tls;
      std::optional<SocketEndpoint> endpoint;
      auto                          url = splitURL(peer);
      HttpRequest                   request{
                            .method = "GET",
                            .target = "/p2p",
      };
      std::vector<std::string> hosts;
      bool                     secure = false;
      bool                     local  = false;
      if (url.scheme == "https" || url.scheme == "wss")
      {
         secure = true;
         tls.emplace();
         request.host = "x-peers." + std::string{url.host};
         hosts.push_back(std::string{url.domain()});
      }
      else if (url.scheme == "http" || url.scheme == "ws")
      {
         request.host = "x-peers." + std::string{url.host};
         hosts.push_back(std::string{url.domain()});
      }
      else
      {
         local        = true;
         request.host = "x-peers.psibase.localhost";
         endpoint     = LocalEndpoint{peer};
      }
      std::int32_t socket = to<XHttp>().websocket(request, std::move(tls), std::move(endpoint));

      auto peers = XPeers{}.open<PeerConnectionTable>();
      auto urls  = XPeers{}.open<UrlTable>();
      PSIBASE_SUBJECTIVE_TX
      {
         to<XHttp>().setCallback(socket, MethodNumber{"onP2P"}, MethodNumber{"errP2P"});
         if (requestSocket)
         {
            auto connectionRequests = XPeers{}.open<ConnectionRequestTable>();
            connectionRequests.put({socket, *requestSocket});
            to<XHttp>().autoClose(*requestSocket, false);
         }

         peers.put({.socket     = socket,
                    .peerSocket = -1,
                    .nodeId     = 0,
                    .urls       = std::vector{peer},
                    .hosts      = std::move(hosts),
                    .secure     = secure,
                    .local      = local,
                    .outgoing   = true});
         addUrl(std::move(peer));
      }
      return socket;
   }

   std::uint64_t myNodeId()
   {
      auto          table = XPeers{}.open<NodeIdTable>();
      std::uint64_t result;
      PSIBASE_SUBJECTIVE_TX
      {
         if (auto row = table.get({}))
         {
            result = row->nodeId;
         }
         else
         {
            psibase::raw::getRandom(&result, sizeof(result));
            table.put({result});
         }
      }
      return result;
   }

   struct IdMessage
   {
      static const std::uint8_t type = 64;
      std::uint64_t             nodeId;
      std::int32_t              connectionId;
      PSIO_REFLECT(IdMessage, nodeId, connectionId)
   };
   struct DuplicateConnectionMessage
   {
      static const std::uint8_t type = 65;
      std::int32_t              connectionId;
      bool                      secure;
      PSIO_REFLECT(DuplicateConnectionMessage, connectionId, secure)
   };
   struct HostnamesMessage
   {
      static const std::uint8_t type = 66;
      std::vector<std::string>  hosts;
      PSIO_REFLECT(HostnamesMessage, hosts)
   };
   struct CheckDuplicatesMessage
   {
      static const std::uint8_t type = 67;
      PSIO_REFLECT(CheckDuplicatesMessage)
   };

   template <typename T>
   std::vector<char> serializeMessage(const T& msg)
   {
      std::vector<char> result;
      result.push_back(T::type);
      psio::vector_stream stream{result};
      psio::to_frac(psio::nested<const T&>{msg}, stream);
      return result;
   }

   template <typename T>
   T deserializeMessage(std::span<const char> msg)
   {
      return psio::from_frac<psio::nested<T>>(msg.subspan(1)).value;
   }

   bool hasCommonHost(const PeerConnection& lhs, const PeerConnection& rhs)
   {
      for (const auto& lhost : lhs.hosts)
      {
         for (const auto& rhost : rhs.hosts)
         {
            if (lhost == rhost)
               return true;
         }
      }
      return false;
   }

   void getDuplicates(PeerConnectionTable&  peers,
                      HostIdTable&          hostIds,
                      const PeerConnection& row,
                      auto&                 result)
   {
      if (row.outgoing)
      {
         // TODO: find other outgoing connections with the same set of hosts
         for (const auto& host : row.hosts)
         {
            for (const auto& duplicate :
                 hostIds.getIndex<0>().subindex(std::tuple(false, host, row.nodeId)))
            {
               result.push_back(
                   {duplicate.socket, DuplicateConnectionMessage{row.peerSocket, row.secure}});
            }
         }
      }
      else
      {
         for (const auto& host : row.hosts)
         {
            for (const auto& duplicate :
                 hostIds.getIndex<0>().subindex(std::tuple(true, host, row.nodeId)))
            {
               auto out = peers.get(duplicate.socket).value();
               result.push_back(
                   {row.socket, DuplicateConnectionMessage{out.peerSocket, out.secure}});
            }
         }
      }
   }

   void updateHosts(HostIdTable& hostIds, PeerConnection& row, std::vector<std::string>&& hosts)
   {
      for (const auto& host : row.hosts)
      {
         hostIds.remove({row.outgoing, host, row.nodeId, row.socket});
      }
      row.hosts = std::move(hosts);
      for (const auto& host : row.hosts)
      {
         hostIds.put({row.outgoing, host, row.nodeId, row.socket});
      }
   }

   void removePeer(std::int32_t socket)
   {
      auto table   = XPeers{}.open<PeerConnectionTable>();
      auto hostIds = XPeers{}.open<HostIdTable>();
      auto urls    = XPeers{}.open<UrlTable>();

      std::vector<std::string> reconnectNow;
      PSIBASE_SUBJECTIVE_TX
      {
         auto row = table.get(socket).value();
         updateHosts(hostIds, row, {});
         table.remove(row);
         reconnectNow = removeUrls(std::move(row.urls));
      }
      for (auto& url : reconnectNow)
      {
         connect(url);
      }
   }

   void recvMessage(std::int32_t socket, IdMessage&& msg)
   {
      auto table   = XPeers{}.open<PeerConnectionTable>();
      auto hostIds = XPeers{}.open<HostIdTable>();
      std::vector<std::pair<std::int32_t, DuplicateConnectionMessage>> messages;
      PSIBASE_SUBJECTIVE_TX
      {
         auto row       = table.get(socket).value();
         row.peerSocket = msg.connectionId;
         row.nodeId     = msg.nodeId;
         table.put(row);
         if (row.fixedHosts())
         {
            for (const auto& host : row.hosts)
            {
               hostIds.put({row.outgoing, host, row.nodeId, socket});
            }
            getDuplicates(table, hostIds, row, messages);
         }
      }
      for (auto&& [peer, msg] : messages)
      {
         to<XHttp>().send(peer, serializeMessage(msg));
      }
   }

   void recvMessage(std::int32_t socket, HostnamesMessage&& msg)
   {
      auto table   = XPeers{}.open<PeerConnectionTable>();
      auto hostIds = XPeers{}.open<HostIdTable>();
      std::vector<std::pair<std::int32_t, DuplicateConnectionMessage>> messages;
      bool                                                             outgoing;
      PSIBASE_SUBJECTIVE_TX
      {
         auto row = table.get(socket).value();
         if (!row.fixedHosts())
         {
            updateHosts(hostIds, row, std::move(msg.hosts));
            table.put(row);
            getDuplicates(table, hostIds, row, messages);
         }
         outgoing = row.outgoing;
      }
      for (auto&& [peer, msg] : messages)
      {
         to<XHttp>().send(peer, serializeMessage(msg));
      }
      if (!outgoing)
         to<XHttp>().send(socket, serializeMessage(CheckDuplicatesMessage{}));
   }
   // After we receive this on an outgoing connection, we know that
   // the peer has received our hostnames, so sending a DuplicateConnectionMessage
   // on a different socket will work correctly.
   void recvMessage(std::int32_t socket, CheckDuplicatesMessage&& msg)
   {
      auto table   = XPeers{}.open<PeerConnectionTable>();
      auto hostIds = XPeers{}.open<HostIdTable>();
      std::vector<std::pair<std::int32_t, DuplicateConnectionMessage>> messages;
      PSIBASE_SUBJECTIVE_TX
      {
         auto row = table.get(socket).value();
         getDuplicates(table, hostIds, row, messages);
      }
      for (auto&& [peer, msg] : messages)
      {
         to<XHttp>().send(peer, serializeMessage(msg));
      }
   }
   void recvMessage(std::int32_t socket, DuplicateConnectionMessage&& msg)
   {
      auto table = XPeers{}.open<PeerConnectionTable>();
      PSIBASE_SUBJECTIVE_TX
      {
         auto out = table.get(socket);
         auto in  = table.get(msg.connectionId);
         if (in && out && out->outgoing)
         {
            if (in->nodeId == out->nodeId && hasCommonHost(*in, *out))
            {
               if (msg.secure && !out->secure ||
                   msg.secure == out->secure && out->nodeId < myNodeId())
               {
                  for (auto& url : out->urls)
                  {
                     if (!std::ranges::contains(in->urls, url))
                     {
                        addUrl(url);
                        in->urls.push_back(std::move(url));
                     }
                  }
                  out->urls.clear();
                  table.put(*in);
                  to<XHttp>().asyncClose(socket);
               }
            }
         }
      }
   }
}  // namespace

auto XPeers::serveSys(const HttpRequest& request, std::optional<std::int32_t> socket)
    -> std::optional<HttpReply>
{
   check(getSender() == XHttp::service, "Wrong sender");
   if (auto reply = to<XAdmin>().checkAuth(request, socket))
      return reply;

   auto target = request.path();
   if (target == "/connect")
   {
      if (request.contentType != "application/json")
      {
         std::string_view msg{"Content-Type must be application/json"};
         return HttpReply{.status      = HttpStatus::unsupportedMediaType,
                          .contentType = "application/html",
                          .body{msg.begin(), msg.end()}};
      }
      if (request.method != "POST")
         return HttpReply::methodNotAllowed(request);
      auto body = psio::convert_from_json<ConnectRequest>(
          std::string(request.body.begin(), request.body.end()));
      connect(body.url, socket);

      return {};
   }
   else if (target == "/disconnect")
   {
      if (request.contentType != "application/json")
      {
         std::string_view msg{"Content-Type must be application/json"};
         return HttpReply{.status      = HttpStatus::unsupportedMediaType,
                          .contentType = "application/html",
                          .body{msg.begin(), msg.end()}};
      }
      if (request.method != "POST")
         return HttpReply::methodNotAllowed(request);

      auto body = psio::convert_from_json<DisconnectRequest>(
          std::string(request.body.begin(), request.body.end()));

      auto                          table = XPeers{}.open<PeerConnectionTable>();
      std::optional<PeerConnection> row;
      PSIBASE_SUBJECTIVE_TX
      {
         row = table.get(body.socket);
         if (row)
         {
            to<XHttp>().asyncClose(row->socket);
         }
      }
      if (row)
      {
         return HttpReply{};
      }
      else
      {
         std::string_view msg{"Socket not found"};
         return HttpReply{.status      = HttpStatus::notFound,
                          .contentType = "application/html",
                          .body{msg.begin(), msg.end()}};
      }
   }
   else if (target == "/p2p")
   {
      if (auto reply = webSocketHandshake(request))
      {
         to<XHttp>().accept(*socket, *reply);
         auto table = Native::session().open<SocketTable>();
         auto peers = open<PeerConnectionTable>();
         PSIBASE_SUBJECTIVE_TX
         {
            auto  row     = table.get(*socket).value();
            auto& oldInfo = std::get<WebSocketInfo>(row.info);
            row.info      = P2PSocketInfo{std::move(oldInfo.endpoint), std::move(oldInfo.tls)};
            table.put(row);
            peers.put({.socket     = *socket,
                       .peerSocket = -1,
                       .nodeId     = 0,
                       .secure     = false,
                       .local      = false,
                       .outgoing   = false});
            to<XHttp>().setCallback(*socket, MethodNumber{"recvP2P"}, MethodNumber{"closeP2P"});
         }
         to<XHttp>().send(*socket, serializeMessage(IdMessage{myNodeId(), *socket}));
         to<XHttp>().send(*socket,
                          serializeMessage(HostnamesMessage{to<XAdmin>().options().hosts}));
      }
   }
   else if (target == "/peers")
   {
      std::vector<PeerConnection> result;
      auto                        peers = open<PeerConnectionTable>();
      PSIBASE_SUBJECTIVE_TX
      {
         for (auto row : peers.getIndex<0>())
         {
            result.push_back(std::move(row));
         }
      }
      HttpReply           reply{.status = HttpStatus::ok, .contentType = "application/json"};
      psio::vector_stream stream{reply.body};
      to_json(result, stream);
      return reply;
   }
   return {};
}

void XPeers::onConfig()
{
   auto                     opts      = open<AdminOptionsTable>();
   auto                     urls      = open<UrlTable>();
   auto                     urlTimers = open<UrlTimerTable>();
   std::vector<std::string> newConnections;
   PSIBASE_SUBJECTIVE_TX
   {
      auto options    = to<XAdmin>().options();
      auto oldOptions = opts.get({}).value_or(AdminOptionsRow{});
      // Unset autoconnect for urls that are no longer in peers
      for (const auto& peer : oldOptions.peers)
      {
         if (!std::ranges::contains(options.peers, peer))
         {
            auto url = urls.get(peer);
            check(url && url->autoconnect, "Url in peers should have autoconnect set");
            if (url->refcount == 0)
            {
               // The timer might not be running, because there's a window
               // between the timer's expiration and when the new connection
               // is started.
               if (url->timerId)
               {
                  to<XTimer>().cancel(*url->timerId);
                  urlTimers.erase(*url->timerId);
                  url->timerId.reset();
               }
               urls.remove(*url);
            }
            else
            {
               url->autoconnect = false;
               urls.put(*url);
            }
         }
      }
      for (const auto& peer : options.peers)
      {
         auto url = urls.get(peer);
         if (!url)
            url = {peer, 0, false, timeoutBase, MonotonicTimePointUSec::min(), std::nullopt};
         if (!url->autoconnect)
         {
            url->autoconnect = true;
            urls.put(*url);
            newConnections.push_back(peer);
         }
      }
      opts.put(options);
   }
   for (auto& url : newConnections)
   {
      connect(url);
   }
}

void XPeers::onP2P(std::int32_t socket, HttpReply reply)
{
   std::optional<ConnectionRequestRow> request;
   auto                                connectionRequests = open<ConnectionRequestTable>();
   PSIBASE_SUBJECTIVE_TX
   {
      auto  table   = Native::session().open<SocketTable>();
      auto  row     = table.get(socket).value();
      auto& oldInfo = std::get<WebSocketInfo>(row.info);
      bool  secure  = oldInfo.tls.has_value();
      bool  local   = oldInfo.endpoint && std::holds_alternative<LocalEndpoint>(*oldInfo.endpoint);
      row.info      = P2PSocketInfo{std::move(oldInfo.endpoint), std::move(oldInfo.tls)};
      table.put(row);
      to<XHttp>().setCallback(socket, MethodNumber{"recvP2P"}, MethodNumber{"closeP2P"});

      request = connectionRequests.get(socket);
      if (request)
      {
         connectionRequests.remove(*request);
         to<XHttp>().autoClose(request->requestSocket, true);
      }
   }
   if (request)
   {
      to<XHttp>().sendReply(request->requestSocket, HttpReply{});
   }
   to<XHttp>().send(socket, serializeMessage(IdMessage{myNodeId(), socket}));
   to<XHttp>().send(socket, serializeMessage(HostnamesMessage{to<XAdmin>().options().hosts}));
}

void XPeers::errP2P(std::int32_t socket, std::optional<HttpReply> reply)
{
   std::optional<ConnectionRequestRow> request;
   auto                                connectionRequests = open<ConnectionRequestTable>();
   auto                                peers              = open<PeerConnectionTable>();
   auto                                urls               = open<UrlTable>();
   std::vector<std::string>            reconnectNow;
   PSIBASE_SUBJECTIVE_TX
   {
      request = connectionRequests.get(socket);
      if (request)
      {
         connectionRequests.remove(*request);
         to<XHttp>().autoClose(request->requestSocket, true);
      }
      auto conn = peers.get(socket);
      check(conn.has_value(), "Missing PeerConnection");
      peers.remove(*conn);
      reconnectNow = removeUrls(std::move(conn->urls));
   }
   if (request)
   {
      std::string_view msg{"Could not open p2p connection"};
      to<XHttp>().sendReply(request->requestSocket, HttpReply{.status      = HttpStatus::badRequest,
                                                              .contentType = "text/html",
                                                              .body{msg.begin(), msg.end()}});
   }
   for (auto& url : reconnectNow)
   {
      connect(std::move(url));
   }
}

void XPeers::recvP2P(std::int32_t socket, psio::view<const std::vector<char>> data)
{
   check(!data.empty(), "Invalid message");
   switch (data[0].unpack())
   {
      case IdMessage::type:
         return recvMessage(socket, deserializeMessage<IdMessage>(data));
      case HostnamesMessage::type:
         return recvMessage(socket, deserializeMessage<HostnamesMessage>(data));
      case CheckDuplicatesMessage::type:
         return recvMessage(socket, deserializeMessage<CheckDuplicatesMessage>(data));
      case DuplicateConnectionMessage::type:
         return recvMessage(socket, deserializeMessage<DuplicateConnectionMessage>(data));
   }
}

void XPeers::closeP2P(std::int32_t socket)
{
   removePeer(socket);
}

void XPeers::onTimer(std::uint64_t timerId)
{
   auto                  timers = open<UrlTimerTable>();
   auto                  urls   = open<UrlTable>();
   std::optional<UrlRow> url;
   PSIBASE_SUBJECTIVE_TX
   {
      if (auto row = timers.get(timerId))
      {
         timers.remove(*row);
         url = urls.get(row->url);
         check(url && url->timerId == timerId,
               "Invariant failure: UrlTimerRow should be removed when it is cancelled");
         check(url->autoconnect && url->refcount == 0,
               "url timer should be cancelled, when not reconnecting");
         url->currentTimeout = std::min(url->currentTimeout + timeoutDelta, timeoutMax);
         url->retryTime += url->currentTimeout;
         url->timerId.reset();
         urls.put(*url);
      }
   }
   if (url)
      connect(url->url);
}

PSIBASE_DISPATCH(XPeers)
