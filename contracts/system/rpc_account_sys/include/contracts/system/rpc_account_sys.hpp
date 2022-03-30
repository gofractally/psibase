#pragma once
#include <psibase/actor.hpp>
#include <psibase/contract_entry.hpp>
#include <psibase/native_tables.hpp>

namespace system_contract
{
   using namespace psibase;
   using psio::const_view;

   struct rpc_account_sys : public psibase::contract
   {
      static constexpr AccountNumber contract = AccountNumber("rpc-sys");

      rpc_reply_data rpc_sys(rpc_request_data request);
      void           upload_rpc_sys(const_view<std::string>       path,
                                    const_view<std::string>       content_type,
                                    const_view<std::vector<char>> content);
   };
   PSIO_REFLECT_INTERFACE(rpc_account_sys,
                          (rpc_sys, 0, request),
                          (upload_rpc_sys, 1, path, content_type, content))
}  // namespace system_contract
