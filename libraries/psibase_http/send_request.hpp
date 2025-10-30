#pragma once

#include <boost/asio/io_context.hpp>
#include <functional>
#include <memory>
#include <optional>
#include <psibase/Rpc.hpp>
#include <psibase/Socket.hpp>
#include <psibase/SocketInfo.hpp>
#include "server_state.hpp"

namespace psibase::http
{
   void send_request(boost::asio::io_context&                                   context,
                     server_state&                                              state,
                     HttpRequest&&                                              req,
                     std::optional<TLSInfo>&&                                   tls,
                     std::optional<SocketEndpoint>&&                            endpoint,
                     const std::function<void(const std::shared_ptr<Socket>&)>& add);
}
