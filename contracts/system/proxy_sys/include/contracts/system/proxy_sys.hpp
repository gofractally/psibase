#pragma once
#include <psibase/actor.hpp>
#include <psibase/contract_entry.hpp>
#include <psibase/native_tables.hpp>

namespace psibase
{
   // Contracts which serve http implement this
   struct ServerInterface : psibase::contract
   {
      rpc_reply_data serveSys(rpc_request_data request);
   };
   PSIO_REFLECT_INTERFACE(ServerInterface, (serveSys, 0, request))

   // Contracts which support uploading files implement this
   struct ServerUploadInterface : psibase::contract
   {
      void uploadSys(psio::const_view<std::string>       path,
                     psio::const_view<std::string>       contentType,
                     psio::const_view<std::vector<char>> content);
   };
   PSIO_REFLECT_INTERFACE(ServerUploadInterface, (uploadSys, 0, path, contentType, content))

   struct proxy_sys : psibase::contract
   {
      // TODO: allow contract to register multiple contracts to handle
      //    * sub.dom.ains.contract
      //    * contract/foo/bar/...
      void registerServer(account_num contract, account_num rpc_contract);
   };
   PSIO_REFLECT_INTERFACE(proxy_sys, (registerServer, 0, contract, rpc_contract))
}  // namespace psibase
