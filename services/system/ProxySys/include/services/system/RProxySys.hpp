#pragma once
#include <psibase/Contract.hpp>
#include <psibase/serviceEntry.hpp>

namespace system_contract
{
   struct RProxySys : public psibase::Contract<RProxySys>
   {
      static constexpr auto service = psibase::AccountNumber("r-proxy-sys");

      auto serveSys(psibase::HttpRequest request) -> std::optional<psibase::HttpReply>;
      void storeSys(std::string path, std::string contentType, std::vector<char> content);
   };
   PSIO_REFLECT(RProxySys,  //
                method(serveSys, request),
                method(storeSys, path, contentType, content))
}  // namespace system_contract
