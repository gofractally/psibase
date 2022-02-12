#pragma once

// TODO: replace fixed_bytes with simplified version
#include <eosio/fixed_bytes.hpp>

namespace newchain
{
   eosio::checksum256 sha256(const char* data, uint32_t length);
}
