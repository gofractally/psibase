#pragma once

#include <optional>
#include <psibase/Rpc.hpp>

namespace psibase
{
   bool isWebSocketHandshake(const HttpRequest& request);
   bool isWebSocketHandshake(const HttpReply& reply);
   bool isWebSocketHandshake(const HttpRequest& request, const HttpReply& reply);
   std::optional<HttpReply> webSocketHandshake(const HttpRequest& request);
   std::string              randomWebSocketKey();

   struct WebSocketFlags
   {
      static constexpr std::uint32_t continuation = 0;
      static constexpr std::uint32_t text         = 1;
      static constexpr std::uint32_t binary       = 2;
      static constexpr std::uint32_t close        = 8;
      static constexpr std::uint32_t ping         = 9;
      static constexpr std::uint32_t pong         = 10;
   };
}  // namespace psibase
