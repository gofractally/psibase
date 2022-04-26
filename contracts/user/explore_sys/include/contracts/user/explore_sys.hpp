#pragma once
#include <psibase/Contract.hpp>
#include <psibase/contract_entry.hpp>
#include <psibase/native_tables.hpp>

namespace system_contract
{
   struct explore_sys : public psibase::Contract<explore_sys>
   {
      static constexpr auto contract = psibase::proxyContractNum;

      auto serveSys(psibase::rpc_request_data request) -> std::optional<psibase::rpc_reply_data>;
      void uploadSys(psio::const_view<std::string>       path,
                     psio::const_view<std::string>       contentType,
                     psio::const_view<std::vector<char>> content);
   };
   PSIO_REFLECT(explore_sys,
                method(serveSys, request),
                method(uploadSys, path, contentType, content))
}  // namespace system_contract
