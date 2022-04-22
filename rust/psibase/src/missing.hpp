#pragma once

#include <memory>
#include "psibase/src/bridge.rs.h"

std::unique_ptr<std::vector<uint8_t>> pack_new_account(rust::Str json);
std::unique_ptr<std::vector<uint8_t>> pack_set_code(rust::Str json);
std::unique_ptr<std::vector<uint8_t>> pack_signed_transaction(rust::Str json);
std::unique_ptr<std::vector<uint8_t>> pack_signed_transactions(rust::Str json);
std::unique_ptr<std::vector<uint8_t>> pack_genesis_action_data(rust::Str json);
std::unique_ptr<std::vector<uint8_t>> pack_startup(rust::Str json);
std::unique_ptr<std::vector<uint8_t>> pack_register_server(rust::Str json);
std::unique_ptr<std::vector<uint8_t>> pack_upload_sys(rust::Str json);
