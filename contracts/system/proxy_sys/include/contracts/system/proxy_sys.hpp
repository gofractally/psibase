#pragma once
#include <psibase/Contract.hpp>
#include <psibase/nativeTables.hpp>

namespace psibase
{
   struct proxy_sys : psibase::Contract<proxy_sys>
   {
      // TODO: allow contract to register multiple contracts to handle
      //    * sub.dom.ains.contract
      //    * contract/foo/bar/... (maybe not; there's a security issue with that)
      void registerServer(AccountNumber contract, AccountNumber rpc_contract);
   };
   PSIO_REFLECT(proxy_sys, method(registerServer, contract, rpc_contract))
}  // namespace psibase
