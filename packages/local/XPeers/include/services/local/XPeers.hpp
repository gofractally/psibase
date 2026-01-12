#pragma once

#include <optional>
#include <psibase/Rpc.hpp>
#include <psibase/Service.hpp>

namespace LocalService
{
   struct XPeers : psibase::Service
   {
      static constexpr auto service = psibase::AccountNumber{"x-peers"};
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
}  // namespace LocalService
