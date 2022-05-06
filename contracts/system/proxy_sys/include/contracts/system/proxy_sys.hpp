#pragma once
#include <psibase/Contract.hpp>
#include <psibase/contract_entry.hpp>
#include <psibase/nativeTables.hpp>

namespace psibase
{
   // Contracts which serve http implement this
   struct ServerInterface
   {
      std::optional<rpc_reply_data> serveSys(rpc_request_data request);
   };
   PSIO_REFLECT(ServerInterface, method(serveSys, request))

   // Contracts which support uploading files implement this
   struct ServerUploadInterface
   {
      void uploadSys(psio::const_view<std::string>       path,
                     psio::const_view<std::string>       contentType,
                     psio::const_view<std::vector<char>> content);
   };
   PSIO_REFLECT(ServerUploadInterface, method(uploadSys, path, contentType, content))

   struct proxy_sys : psibase::Contract<proxy_sys>
   {
      // TODO: allow contract to register multiple contracts to handle
      //    * sub.dom.ains.contract
      //    * contract/foo/bar/... (maybe not; there's a security issue with that)
      void registerServer(AccountNumber contract, AccountNumber rpc_contract);
   };
   PSIO_REFLECT(proxy_sys, method(registerServer, contract, rpc_contract))
}  // namespace psibase
