#pragma once

#include <optional>
#include <psibase/Rpc.hpp>
#include <psibase/Service.hpp>
#include <psibase/Table.hpp>

namespace LocalService
{
   struct ConnectionRequestRow
   {
      std::int32_t peerSocket;
      std::int32_t requestSocket;
      PSIO_REFLECT(ConnectionRequestRow, peerSocket, requestSocket)
   };
   using ConnectionRequestTable =
       psibase::Table<ConnectionRequestRow, &ConnectionRequestRow::peerSocket>;
   PSIO_REFLECT_TYPENAME(ConnectionRequestTable)

   struct XPeers : psibase::Service
   {
      static constexpr auto service = psibase::AccountNumber{"x-peers"};
      using Session                 = psibase::SessionTables<ConnectionRequestTable>;
      auto serveSys(const psibase::HttpRequest& request, std::optional<std::int32_t> user)
          -> std::optional<psibase::HttpReply>;

      void onP2P(std::int32_t socket, psibase::HttpReply reply);
      void errP2P(std::int32_t socket, std::optional<psibase::HttpReply> reply);
      void recvP2P(std::int32_t socket, psio::view<const std::vector<char>> data);
      void closeP2P(std::int32_t socket);
   };
   PSIO_REFLECT(XPeers,
                method(serveSys, request, socket),
                method(onP2P, socket, reply),
                method(errP2P, socekt, reply),
                method(recvP2P, socket, data),
                method(closeP2P, socket))
   PSIBASE_REFLECT_TABLES(XPeers, XPeers::Session)
}  // namespace LocalService
