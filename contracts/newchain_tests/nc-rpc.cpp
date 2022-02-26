#include "nc-token.hpp"

#include <newchain/intrinsic.hpp>
#include <newchain/native_tables.hpp>
#include <newchain/rpc.hpp>

using namespace newchain;

static constexpr bool enable_print = true;

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
         std::vector<account_row> rows;
         for (account_num i = 1;; ++i)
         {
            auto acc = get_kv<account_row>(account_key(i));
            if (!acc)
               break;
            rows.push_back(std::move(*acc));
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
