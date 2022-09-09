#pragma once
#include <psibase/Service.hpp>
#include <psibase/nativeTables.hpp>
#include <psibase/serviceEntry.hpp>

namespace SystemService
{
   /// The `proxy-sys` service routes HTTP requests to the appropriate service
   ///
   /// Rule set:
   /// - If the target starts with `/common`, then route the request to [SystemService::CommonSys].
   /// - Else if there's a subdomain and it references a registered service, then route the request to that service.
   /// - Else if the request references an unregistered subdomain, then route the request to `psispace-sys`.
   /// - Else route the request to [CommonSys]; this handles the chain's main domain.
   ///
   /// See [Web Services](../cpp-service/reference/web-services.md) for more detail, including how to write services which serve HTTP requests.
   ///
   /// #### serve export (not an action)
   ///
   /// This service has the following WASM exported function:
   ///
   /// ```c++
   /// extern "C" [[clang::export_name("serve")]] void serve()
   /// ```
   ///
   /// `psinode` calls this function on the `proxy-sys` service whenever it receives
   /// an HTTP request that services may serve. This function does the actual routing.
   /// `psinode` has a local option (TODO: implement) which may choose an alternative
   /// routing service instead.
   struct ProxySys : psibase::Service<ProxySys>
   {
      static constexpr auto service = psibase::proxyServiceNum;

      /// Register senders's subdomain
      ///
      /// `server` will handle requests to this subdomain.
      void registerServer(psibase::AccountNumber server);
   };
   PSIO_REFLECT(ProxySys, method(registerServer, server))
}  // namespace SystemService
