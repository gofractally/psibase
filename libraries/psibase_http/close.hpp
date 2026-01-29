#pragma once

#include <psibase/Socket.hpp>
#include <psibase/log.hpp>
#include "server_state.hpp"

namespace psibase::http
{
   void callClose(const server_state&     server,
                  loggers::common_logger& logger,
                  AutoCloseSocket&        socket);

}
