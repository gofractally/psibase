#pragma once
#include <psibase/Service.hpp>
#include <psibase/serviceEntry.hpp>

namespace SystemService
{
   struct RProxySys : public psibase::Service<RProxySys>
   {
      static constexpr auto service = psibase::AccountNumber("rproxy-sys");

      auto serveSys(psibase::HttpRequest request) -> std::optional<psibase::HttpReply>;
      void storeSys(std::string path, std::string contentType, std::vector<char> content);
   };
   PSIO_REFLECT(RProxySys,  //
                method(serveSys, request),
                method(storeSys, path, contentType, content))
}  // namespace SystemService
