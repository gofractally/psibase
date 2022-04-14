#include <contracts/system/proxy_sys.hpp>
#include <psibase/actor.hpp>
#include <psibase/dispatch.hpp>
#include <psibase/native_tables.hpp>
#include <psio/fracpack.hpp>
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

   void proxy_sys::registerServer(AccountNumber contract, AccountNumber rpcContract)
   {
      check(contract == get_sender(), "wrong sender");
      RegisteredContractRow row{
          .contract    = contract,
          .rpcContract = rpcContract,
      };
      kv_put(row.key(get_receiver()), row);
   }

   extern "C" [[clang::export_name("serve")]] void serve()
   {
      auto act = get_current_action();
      // TODO: use a view
      auto req = psio::convert_from_frac<rpc_request_data>(act.raw_data);

      std::string contractName;

      // Path reserved across all subdomains
      if (req.target.starts_with("/common"))
         contractName = "common-sys";

      // subdomain
      else if (req.host.size() > req.root_host.size() + 1 && req.host.ends_with(req.root_host) &&
               req.host[req.host.size() - req.root_host.size() - 1] == '.')
         contractName.assign(req.host.begin(), req.host.end() - req.root_host.size() - 1);

      // root domain
      else
         contractName = "common-sys";

      auto contract = AccountNumber(contractName);
      auto reg      = kv_get<RegisteredContractRow>(registeredContractKey(act.contract, contract));
      if (!reg)
         abort_message_str("contract not registered: " + contract.str());

      // TODO: avoid repacking (both directions)
      psibase::actor<ServerInterface> iface(act.contract, reg->rpcContract);
      set_retval(iface.serveSys(req).unpack());
   }  // serve()

}  // namespace psibase

PSIBASE_DISPATCH(psibase::proxy_sys)
