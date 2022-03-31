#pragma once
#include <psibase/actor.hpp>
#include <psibase/contract_entry.hpp>
#include <psibase/native_tables.hpp>

namespace system_contract
{
   struct rpc_account_sys : public psibase::contract
   {
      static constexpr auto contract = psibase::rpcContractNum;

      psibase::rpc_reply_data rpc_sys(psibase::rpc_request_data request);
      void                    upload_rpc_sys(psio::const_view<std::string>       path,
                                             psio::const_view<std::string>       contentType,
                                             psio::const_view<std::vector<char>> content);
   };
   PSIO_REFLECT_INTERFACE(rpc_account_sys,
                          (rpc_sys, 0, request),
                          (upload_rpc_sys, 1, path, contentType, content))
}  // namespace system_contract
