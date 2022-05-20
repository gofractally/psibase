#pragma once
#include <psibase/Contract.hpp>
#include <psibase/contractEntry.hpp>
#include <psibase/nativeTables.hpp>

namespace system_contract
{
   struct rpc_account_sys : public psibase::Contract<rpc_account_sys>
   {
      auto serveSys(psibase::RpcRequestData request) -> std::optional<psibase::RpcReplyData>;
      void storeSys(psio::const_view<std::string>       path,
                    psio::const_view<std::string>       contentType,
                    psio::const_view<std::vector<char>> content);
   };
   PSIO_REFLECT(rpc_account_sys,
                method(serveSys, request),
                method(storeSys, path, contentType, content))
}  // namespace system_contract
