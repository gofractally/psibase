#pragma once
#include <psibase/Contract.hpp>
#include <psibase/contractEntry.hpp>
#include <psibase/nativeTables.hpp>

namespace psibase
{
   /// The `proxy-sys` contract routes HTTP requests to the appropriate contract
   ///
   /// Rule set:
   /// - If the target starts with `/common`, then route the request to [system_contract::CommonSys].
   /// - Else if there's a subdomain and it references a registered contract, then route the request to that contract.
   /// - Else if the request references an unregistered subdomain, then route the request to `psispace-sys`.
   /// - Else route the request to [CommonSys]; this handles the chain's main domain.
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
   struct ProxySys : psibase::Contract<ProxySys>
   {
      static constexpr auto contract = psibase::proxyContractNum;

      /// Register senders's subdomain
      ///
      /// `serverContract` will handle requests to this subdomain.
      void registerServer(AccountNumber serverContract);
   };
   PSIO_REFLECT(ProxySys, method(registerServer, serverContract))
}  // namespace psibase
