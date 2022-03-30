#include <psio/fracpack.hpp>
#include <psio/to_json.hpp>
#include <contracts/system/rpc_sys.hpp>

#include <psibase/dispatch.hpp>
#include <psibase/native_tables.hpp>
#include "contracts/system/account_sys.hpp"

static constexpr bool enable_print = false;

namespace psibase
{
   static constexpr table_num registered_contract_table = 1;

   inline auto registered_contract_key(account_num this_contract, account_num contract)
   {
      return std::tuple{this_contract, registered_contract_table, contract};
   }
   struct registered_contract_row
   {
      account_num contract     = {};
      account_num rpc_contract = {};

      auto key(account_num this_contract)
      {
         return registered_contract_key(this_contract, contract);
      }
   };
   PSIO_REFLECT(registered_contract_row, contract, rpc_contract)

   void rpc_sys::register_contract(account_num contract, account_num rpc_contract)
   {
      check(contract == get_sender(), "wrong sender");
      registered_contract_row row{
          .contract     = contract,
          .rpc_contract = rpc_contract,
      };
      kv_put(row.key(get_receiver()), row);
   }
}  // namespace psibase

PSIBASE_DISPATCH(psibase::rpc_sys)

namespace psibase
{
   extern "C" [[clang::export_name("rpc")]] void rpc()
   {
      auto act = get_current_action();
      /// TODO... use a view
      auto req = psio::convert_from_frac<rpc_request_data>(act.raw_data);

      auto to_json = [](const auto& obj) {
         auto json = psio::convert_to_json(obj);
         set_retval(rpc_reply_data{
             .content_type = "application/json",
             .reply        = {json.begin(), json.end()},
         });
      };

      std::string contract_name;

      // Path reserved across all subdomains
      if (req.target.starts_with("/roothost"))
         contract_name = "rpc.roothost.sys";
      else if (req.host.size() > req.root_host.size() + 1 && req.host.ends_with(req.root_host) &&
               req.host[req.host.size() - req.root_host.size() - 1] == '.')
         contract_name.assign(req.host.begin(), req.host.end() - req.root_host.size() - 1);
      else
         contract_name = "rpc.roothost.sys";

      // TODO: remove lookup after account number type is changed
      psibase::actor<system_contract::account_sys> asys(act.contract, system_contract::account_sys::contract);

      /*
      auto                        account_num = asys.get_account_by_name(contract_name).unpack();
      if (!account_num)
         abort_message("unknown contract: " + contract_name);

      auto reg =
          kv_get<registered_contract_row>(registered_contract_key(act.contract, *account_num));
      check(!!reg, "contract not registered");
      if (!reg)
         abort_message("contract not registered: " + contract_name);

      // TODO: avoid repacking (both directions)
      psibase::actor<rpc_interface> iface(act.contract, reg->rpc_contract);
      set_retval(iface.rpc_sys(req).unpack());
         */
   }  // rpc()

}  // namespace psibase
