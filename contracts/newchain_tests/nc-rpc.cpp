#include "nc-name.hpp"

#include <newchain/intrinsic.hpp>
#include <newchain/native_tables.hpp>
#include <newchain/rpc.hpp>

using namespace newchain;

static constexpr bool enable_print = true;

struct augmented_account_row : account_row
{
   std::optional<std::string> name;
   std::optional<std::string> auth_contract_name;
};
EOSIO_REFLECT(augmented_account_row, base account_row, name, auth_contract_name)

namespace rpc
{
   extern "C" [[clang::export_name("rpc")]] void rpc()
   {
      auto act = get_current_action();
      auto req = eosio::convert_from_bin<rpc_request_data>(act.raw_data);

      auto to_json = [](const auto& obj) {
         auto json = eosio::format_json(obj);
         set_retval(rpc_reply_data{
             .content_type = "application/json",
             .reply        = {json.begin(), json.end()},
         });
      };

      if (req.method == "GET" && req.target == "/psiq/status")
      {
         auto status = get_kv<status_row>(status_key());
         return to_json(*status);
      }
      else if (req.method == "GET" && req.target == "/psiq/accounts")
      {
         std::vector<augmented_account_row> rows;
         for (account_num i = 1;; ++i)
         {
            auto acc = get_kv<account_row>(account_key(i));
            if (!acc)
               break;
            augmented_account_row aug;
            (account_row&)aug      = *acc;
            aug.name               = name::call(act.contract, name::get_by_num{aug.num});
            aug.auth_contract_name = name::call(act.contract, name::get_by_num{aug.auth_contract});
            rows.push_back(std::move(aug));
         }
         return to_json(rows);
      }
      abort_message("Unknown endpoint");
   }

   extern "C" void called(account_num this_contract, account_num sender)
   {
      abort_message("Contract has no actions");
   }

   extern "C" void __wasm_call_ctors();
   extern "C" void start(account_num this_contract) { __wasm_call_ctors(); }
}  // namespace rpc
