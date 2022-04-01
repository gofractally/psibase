#pragma once
#include <psibase/actor.hpp>
#include <psibase/contract_entry.hpp>
#include <psibase/native_tables.hpp>

namespace psibase
{
   struct rpc_interface : psibase::contract
   {
      rpc_reply_data rpc_sys(rpc_request_data request);
   };
   PSIO_REFLECT_INTERFACE(rpc_interface, (rpc_sys, 0, request))

   // TODO: rename to proxy_sys? proxy_sy?
   struct rpc_sys : psibase::contract
   {
      // TODO: allow contract to register multiple contracts to handle
      //    * sub.dom.ains.contract
      //    * contract/foo/bar/...
      void register_contract(account_num contract, account_num rpc_contract);
   };
   PSIO_REFLECT_INTERFACE(rpc_sys, (register_contract, 0, contract, rpc_contract))
}  // namespace psibase
