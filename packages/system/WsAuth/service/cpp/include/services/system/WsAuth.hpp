#pragma once

#include <optional>
#include <psibase/Rpc.hpp>
#include <psibase/Service.hpp>
#include <psibase/nativeTables.hpp>
#include <string>

namespace SystemService
{
   struct WsTicketInfo
   {
      psibase::AccountNumber user;
      psibase::AccountNumber app;
      PSIO_REFLECT(WsTicketInfo, user, app)
   };

   struct WsAuth : psibase::Service
   {
      static constexpr auto service           = psibase::AccountNumber("wsauth");
      static constexpr auto serviceFlags      = psibase::CodeRow::isPrivileged;
      static constexpr auto subprotocolPrefix = std::string_view{"psibase.ws-ticket."};

      auto serveSys(psibase::HttpRequest        request,
                    std::optional<std::int32_t> socket) -> std::optional<psibase::HttpReply>;

      /// Redeems a ticket minted for the sender.
      ///
      /// Returns the user and app, or nullopt if the ticket is missing,
      /// expired, or was minted for another service. A redeemed ticket
      /// cannot be used again.
      std::optional<WsTicketInfo> consume(std::string ticket);

      static std::optional<std::string> getTicket(const psibase::HttpRequest& request)
      {
         for (auto protocol : request.getHeaderValues("Sec-WebSocket-Protocol"))
         {
            if (protocol.starts_with(subprotocolPrefix))
               return std::string(protocol.substr(subprotocolPrefix.size()));
         }
         return std::nullopt;
      }
   };
   PSIO_REFLECT(WsAuth, method(serveSys, request, socket), method(consume, ticket))
}  // namespace SystemService
