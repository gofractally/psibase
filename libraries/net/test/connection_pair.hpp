#pragma once

#include <boost/asio/io_context.hpp>
#include <memory>
#include <psibase/peer_manager.hpp>
#include <utility>

namespace psibase::net
{
   std::pair<std::shared_ptr<connection_base>, std::shared_ptr<connection_base>>
   make_connection_pair(boost::asio::io_context&);
}
