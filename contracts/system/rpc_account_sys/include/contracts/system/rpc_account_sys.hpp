#pragma once
#include <psibase/Contract.hpp>
#include <psibase/contract_entry.hpp>
#include <psibase/nativeTables.hpp>

namespace system_contract
{
   struct rpc_account_sys : public psibase::Contract<rpc_account_sys>
   {
      auto serveSys(psibase::rpc_request_data request) -> std::optional<psibase::rpc_reply_data>;
      void uploadSys(psio::const_view<std::string>       path,
                     psio::const_view<std::string>       contentType,
                     psio::const_view<std::vector<char>> content);
   };
   PSIO_REFLECT(rpc_account_sys,
                method(serveSys, request),
                method(uploadSys, path, contentType, content))
}  // namespace system_contract
