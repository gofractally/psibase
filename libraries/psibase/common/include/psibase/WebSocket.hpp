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
}  // namespace psibase
