#pragma once

#include <memory>
#include <triedent/database.hpp>

std::shared_ptr<triedent::database> createDb(const triedent::database::config& cfg = {
                                                 .hot_bytes  = 1ull << 30,
                                                 .warm_bytes = 1ull << 30,
                                                 .cool_bytes = 1ull << 30,
                                                 .cold_bytes = 1ull << 30,
                                             });
