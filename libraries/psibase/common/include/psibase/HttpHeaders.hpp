#pragma once

#include <optional>
#include <psibase/Rpc.hpp>
#include <psibase/SocketInfo.hpp>

namespace psibase
{
   /// Parses the Forwarded and X-Forwarded-For headers
   /// and returns a list of IP addresses. Unparsable
   /// items and items that have a missing, opaque or
   /// unknown "for" field are represented as nullopt.
   std::vector<std::optional<IPAddress>> forwardedFor(const HttpRequest& request);
}  // namespace psibase
