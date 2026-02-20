#pragma once

#include <optional>
#include <psibase/Rpc.hpp>
#include <psibase/Service.hpp>
#include <psibase/Table.hpp>
#include <services/local/XAdmin.hpp>

namespace LocalService
{
   struct NodeIdRow
   {
      std::uint64_t nodeId;
      PSIO_REFLECT(NodeIdRow, nodeId);
   };
   using NodeIdTable = psibase::Table<NodeIdRow, psibase::SingletonKey{}>;
   PSIO_REFLECT_TYPENAME(NodeIdTable)

   struct ConnectionRequestRow
   {
      std::int32_t                     peerSocket;
      std::int32_t                     requestSocket;
      std::vector<psibase::HttpHeader> replyHeaders;
      PSIO_REFLECT(ConnectionRequestRow, peerSocket, requestSocket, replyHeaders)
   };
   using ConnectionRequestTable =
       psibase::Table<ConnectionRequestRow, &ConnectionRequestRow::peerSocket>;
   PSIO_REFLECT_TYPENAME(ConnectionRequestTable)

   struct PeerConnection
   {
      std::int32_t             socket;
      std::int32_t             peerSocket;
      std::uint64_t            nodeId;
      std::vector<std::string> urls;
      std::vector<std::string> hosts;
      bool                     secure;
      bool                     local;
      bool                     outgoing;

      // Returns true if hosts are determined at connection time
      // and unchangable, false if the hosts are loaded from a
      // hostnamesMessage
      bool fixedHosts() const { return outgoing && !local; }
      PSIO_REFLECT(PeerConnection, socket, peerSocket, nodeId, urls, hosts, secure, local, outgoing)
   };
   using PeerConnectionTable =
       psibase::Table<PeerConnection,
                      &PeerConnection::socket,
                      psibase::CompositeKey<&PeerConnection::outgoing, &PeerConnection::socket>{}>;
   PSIO_REFLECT_TYPENAME(PeerConnectionTable)

   struct UrlRow
   {
      std::string   url;
      std::uint32_t refcount;
      bool          autoconnect;
      // Increased whenever the connection times out. Reset to the
      // base value when retryTime is reached without the connection
      // failing.
      psibase::MicroSeconds currentTimeout;
      // The earliest time that a connection will be retried
      psibase::MonotonicTimePointUSec retryTime;
      std::optional<std::uint64_t>    timerId;
      PSIO_REFLECT(UrlRow, url, refcount, autoconnect, currentTimeout, retryTime, timerId)
   };
   using UrlTable = psibase::Table<UrlRow, &UrlRow::url>;
   PSIO_REFLECT_TYPENAME(UrlTable)

   struct UrlTimerRow
   {
      std::uint64_t timerId;
      std::string   url;
      PSIO_REFLECT(UrlTimerRow, timerId, url)
   };
   using UrlTimerTable = psibase::Table<UrlTimerRow, &UrlTimerRow::timerId>;
   PSIO_REFLECT_TYPENAME(UrlTimerTable)

   struct HostIdRow
   {
      bool          outgoing;
      std::string   host;
      std::uint64_t nodeId;
      std::int32_t  socket;
      PSIO_REFLECT(HostIdRow, outgoing, host, nodeId, socket)
   };
   using HostIdTable = psibase::Table<HostIdRow,
                                      psibase::CompositeKey<&HostIdRow::outgoing,
                                                            &HostIdRow::host,
                                                            &HostIdRow::nodeId,
                                                            &HostIdRow::socket>{}>;
   PSIO_REFLECT_TYPENAME(HostIdTable)

   struct XPeers : psibase::Service
   {
      static constexpr auto service = psibase::AccountNumber{"x-peers"};
      using Session                 = psibase::SessionTables<NodeIdTable,
                                                             ConnectionRequestTable,
                                                             PeerConnectionTable,
                                                             HostIdTable,
                                                             UrlTable,
                                                             UrlTimerTable,
                                                             AdminOptionsTable>;
      auto serveSys(const psibase::HttpRequest& request, std::optional<std::int32_t> user)
          -> std::optional<psibase::HttpReply>;

      // Called by XAdmin to handle config changes (host names/peers)
      void onConfig();

      // Internal callbacks
      void onP2P(std::int32_t socket, psibase::HttpReply reply);
      void errP2P(std::int32_t socket, std::optional<psibase::HttpReply> reply);
      void recvP2P(std::int32_t socket, psio::view<const std::vector<char>> data);
      void closeP2P(std::int32_t socket);
      void onTimer(std::uint64_t timerId);
   };
   PSIO_REFLECT(XPeers,
                method(serveSys, request, socket),
                method(onConfig),
                method(onP2P, socket, reply),
                method(errP2P, socekt, reply),
                method(recvP2P, socket, data),
                method(closeP2P, socket),
                method(onTimer, timerId))
   PSIBASE_REFLECT_TABLES(XPeers, XPeers::Session)
}  // namespace LocalService
