#pragma once
#include <psibase/actor.hpp>
#include <psibase/contract_entry.hpp>
#include <psibase/native_tables.hpp>

namespace system_contract
{
   struct rpc_account_sys : public psibase::contract
   {
      psibase::rpc_reply_data serveSys(psibase::rpc_request_data request);
      void                    uploadSys(psio::const_view<std::string>       path,
                                        psio::const_view<std::string>       contentType,
                                        psio::const_view<std::vector<char>> content);
   };
   PSIO_REFLECT(rpc_account_sys,
                method(serveSys, request),
                method(uploadSys, path, contentType, content))
}  // namespace system_contract
