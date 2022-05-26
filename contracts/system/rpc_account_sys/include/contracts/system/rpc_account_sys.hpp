#pragma once
#include <psibase/Contract.hpp>
#include <psibase/contractEntry.hpp>

namespace system_contract
{
   struct rpc_account_sys : public psibase::Contract<rpc_account_sys>
   {
      auto serveSys(psibase::RpcRequestData request) -> std::optional<psibase::RpcReplyData>;
      void storeSys(std::string path, std::string contentType, std::vector<char> content);
   };
   PSIO_REFLECT(rpc_account_sys,
                method(serveSys, request),
                method(storeSys, path, contentType, content))
}  // namespace system_contract
