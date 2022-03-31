#include <contracts/system/rpc_sys.hpp>
#include <psio/fracpack.hpp>

#include <psibase/dispatch.hpp>
#include <psibase/native_tables.hpp>
#include "contracts/system/account_sys.hpp"

static constexpr bool enable_print = false;

namespace psibase
{
   using table_num = uint16_t;

   static constexpr table_num registered_contract_table = 1;

   inline auto registeredContractKey(AccountNumber this_contract, AccountNumber contract)
   {
      return std::tuple{this_contract, registered_contract_table, contract};
   }
   struct RegisteredContractRow
   {
      AccountNumber contract    = {};
      AccountNumber rpcContract = {};

      auto key(AccountNumber this_contract)
      {
         return registeredContractKey(this_contract, contract);
      }
   };
   PSIO_REFLECT(RegisteredContractRow, contract, rpcContract)

   void rpc_sys::register_contract(AccountNumber contract, AccountNumber rpcContract)
   {
      check(contract == get_sender(), "wrong sender");
      RegisteredContractRow row{
          .contract    = contract,
          .rpcContract = rpcContract,
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
      // TODO: use a view
      auto req = psio::convert_from_frac<rpc_request_data>(act.raw_data);

      std::string contractName;

      // Path reserved across all subdomains
      if (req.target.starts_with("/roothost"))
         contractName = "roothost-sys";
      else if (req.host.size() > req.root_host.size() + 1 && req.host.ends_with(req.root_host) &&
               req.host[req.host.size() - req.root_host.size() - 1] == '.')
         contractName.assign(req.host.begin(), req.host.end() - req.root_host.size() - 1);
      else
         contractName = "roothost-sys";

      auto contract = AccountNumber(contractName);
      auto reg      = kv_get<RegisteredContractRow>(registeredContractKey(act.contract, contract));
      if (!reg)
         abort_message_str("contract not registered: " + contract.str());

      // TODO: avoid repacking (both directions)
      psibase::actor<rpc_interface> iface(act.contract, reg->rpcContract);
      set_retval(iface.rpc_sys(req).unpack());
   }  // rpc()

}  // namespace psibase
