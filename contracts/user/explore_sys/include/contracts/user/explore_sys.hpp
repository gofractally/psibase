#pragma once
#include <psibase/Contract.hpp>
#include <psibase/contractEntry.hpp>
#include <psibase/nativeTables.hpp>

namespace system_contract
{
   struct explore_sys : public psibase::Contract<explore_sys>
   {
      static constexpr auto contract = psibase::proxyContractNum;

      auto serveSys(psibase::RpcRequestData request) -> std::optional<psibase::RpcReplyData>;
      void storeSys(std::string path, std::string contentType, std::vector<char> content);
   };
   PSIO_REFLECT(explore_sys,
                method(serveSys, request),
                method(storeSys, path, contentType, content))
}  // namespace system_contract
