#pragma once
#include <psibase/Contract.hpp>
#include <psibase/nativeTables.hpp>

namespace psibase
{
   /// The `proxy-sys` contract routes HTTP requests to the appropriate contract
   ///
   /// Rule set:
   /// - If the request references an unregistered subdomain, then abort with a message indicating it needs registration.
   /// - Else if the target starts with `/common`, then route the request to [common_sys].
   /// - Else if there's a subdomain and it references a registered contract, then route the request to that contract.
   /// - Else route the request to [common_sys]; this handles the chain's main domain.
   ///
   /// See [Web Services](../cpp-contract/reference/web-services.md) for more detail, including how to write contracts which serve HTTP requests.
   ///
   /// #### serve export (not an action)
   ///
   /// This contract has the following WASM exported function:
   ///
   /// ```c++
   /// extern "C" [[clang::export_name("serve")]] void serve()
   /// ```
   ///
   /// `psinode` calls this function on the `proxy-sys` contract whenever it receives
   /// an HTTP request that contracts may serve. This function does the actual routing.
   /// `psinode` has a local option (TODO: implement) which may choose an alternative
   /// routing contract instead.
   struct proxy_sys : psibase::Contract<proxy_sys>
   {
      // TODO: allow contract to register multiple contracts to handle
      //    * sub.dom.ains.contract (what's the use case?)
      //    * contract/foo/bar/... (maybe not; there's a security issue with that)

      /// Register `contract`'s subdomain
      ///
      /// `rpc_contract` will handle requests to this subdomain.
      void registerServer(AccountNumber contract, AccountNumber rpc_contract);
   };
   PSIO_REFLECT(proxy_sys, method(registerServer, contract, rpc_contract))
}  // namespace psibase
