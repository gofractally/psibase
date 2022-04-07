#pragma once
#include <psibase/actor.hpp>
#include <psibase/contract_entry.hpp>
#include <psibase/native_tables.hpp>

namespace psibase
{
   struct rpc_roothost_sys : psibase::contract
   {
      static constexpr auto contract = psibase::AccountNumber("roothost-sys");

      rpc_reply_data serveSys(rpc_request_data request);
      void           uploadSys(psio::const_view<std::string>       path,
                               psio::const_view<std::string>       contentType,
                               psio::const_view<std::vector<char>> content);
   };
   PSIO_REFLECT_INTERFACE(rpc_roothost_sys,
                          (serveSys, 0, request),
                          (uploadSys, 1, path, contentType, content))
}  // namespace psibase
