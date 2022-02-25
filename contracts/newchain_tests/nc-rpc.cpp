#include "nc-token.hpp"

#include <newchain/intrinsic.hpp>
#include <newchain/rpc.hpp>

using namespace newchain;

static constexpr bool enable_print = true;

namespace rpc
{
   extern "C" void called(account_num this_contract, account_num sender)
   {
      auto act = get_current_action();
      auto req = eosio::convert_from_bin<rpc_request_data>(act.raw_data);

      auto json = eosio::format_json(req);
      set_retval(rpc_reply_data{
          .content_type = "application/json",
          .reply        = {json.begin(), json.end()},
      });
   }

   extern "C" void __wasm_call_ctors();
   extern "C" void start(account_num this_contract) { __wasm_call_ctors(); }
}  // namespace rpc
