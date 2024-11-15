#pragma once

#include <psibase/http.hpp>
#include <psibase/peer_manager.hpp>

#include <functional>
#include <memory>
#include <string>

using connect_success_callback =
    std::function<std::error_code(std::shared_ptr<psibase::net::connection_base>&&)>;
using connect_handler = std::function<void(std::error_code)>;

std::function<void(const std::string& peer, connect_handler&&)> make_connect_one(
    boost::asio::ip::tcp::resolver&                    resolver,
    boost::asio::io_context&                           chainContext,
    const std::shared_ptr<psibase::http::http_config>& http_config,
    connect_success_callback                           add);
