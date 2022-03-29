#pragma once
#include <psibase/actor.hpp>
#include <psibase/contract_entry.hpp>
#include <psibase/native_tables.hpp>

namespace psibase
{
   struct rpc_roothost_sys : psibase::contract
   {
      rpc_reply_data rpc_sys(rpc_request_data request);
      void           upload_rpc_sys(psio::const_view<std::string>       path,
                                    psio::const_view<std::string>       content_type,
                                    psio::const_view<std::vector<char>> content);
   };
   PSIO_REFLECT_INTERFACE(rpc_roothost_sys,
                          (rpc_sys, 0, request),
                          (upload_rpc_sys, 1, path, content_type, content))
}  // namespace psibase
