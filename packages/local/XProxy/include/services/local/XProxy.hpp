#pragma once

#include <cstdint>
#include <optional>
#include <psibase/Rpc.hpp>
#include <psibase/Service.hpp>
#include <psibase/SocketInfo.hpp>
#include <psibase/Table.hpp>
#include <string>
#include <vector>

namespace LocalService
{
   struct OriginServerRow
   {
      psibase::AccountNumber                  subdomain;
      std::string                             host;
      std::optional<psibase::TLSInfo>         tls;
      std::optional<psibase::SocketEndpoint>  endpoint;
      std::optional<std::vector<std::string>> bypassPrefixes;
      PSIO_REFLECT(OriginServerRow, subdomain, host, tls, endpoint, bypassPrefixes)
   };
   using OriginServerTable = psibase::Table<OriginServerRow, &OriginServerRow::subdomain>;
   PSIO_REFLECT_TYPENAME(OriginServerTable)

   struct ProxyRow
   {
      std::int32_t socket1;
      std::int32_t socket2;
      PSIO_REFLECT(ProxyRow, socket1, socket2)
   };
   using ProxyTable = psibase::Table<ProxyRow, &ProxyRow::socket1>;
   PSIO_REFLECT_TYPENAME(ProxyTable)

   struct WebSocketRow
   {
      std::int32_t from;
      std::int32_t to;
      PSIO_REFLECT(WebSocketRow, from, to)
   };
   using WebSocketTable = psibase::Table<WebSocketRow, &WebSocketRow::from, &WebSocketRow::to>;
   PSIO_REFLECT_TYPENAME(WebSocketTable)

   struct XProxy : psibase::Service
   {
      static constexpr auto service = psibase::AccountNumber{"x-proxy"};
      using Subjective              = psibase::SubjectiveTables<OriginServerTable>;
      using Session                 = psibase::SessionTables<ProxyTable, WebSocketTable>;

      auto serveSys(psibase::HttpRequest        req,
                    std::optional<std::int32_t> socket) -> std::optional<psibase::HttpReply>;
      void onReply(std::int32_t socket, psibase::HttpReply reply);
      void onAccept(std::int32_t socket, psibase::HttpReply reply);
      void onError(std::int32_t socket, std::optional<psibase::HttpReply> reply);
      void recv(std::int32_t socket, psio::view<const std::vector<char>> data, std::uint32_t flags);
      void close(std::int32_t socket);
   };
   PSIO_REFLECT(XProxy,
                method(serveSys, request, socket),
                method(onReply, socket, reply),
                method(onAccept, socket, reply),
                method(onError, socket, reply),
                method(recv, socket, data, flags),
                method(close, socket))
   PSIBASE_REFLECT_TABLES(XProxy, XProxy::Subjective, XProxy::Session)
}  // namespace LocalService
