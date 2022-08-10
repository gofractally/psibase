#pragma once
#include <psibase/Contract.hpp>
#include <psibase/contractEntry.hpp>

namespace system_contract
{
   struct RAccountSys : public psibase::Contract<RAccountSys>
   {
      static constexpr auto contract = psibase::AccountNumber("r-account-sys");

      auto serveSys(psibase::RpcRequestData request) -> std::optional<psibase::RpcReplyData>;
      void storeSys(std::string path, std::string contentType, std::vector<char> content);

     private:
      std::optional<psibase::RpcReplyData> serveRestEndpoints(psibase::RpcRequestData& request);
   };
   PSIO_REFLECT(RAccountSys,
                method(serveSys, request),
                method(storeSys, path, contentType, content))
}  // namespace system_contract
