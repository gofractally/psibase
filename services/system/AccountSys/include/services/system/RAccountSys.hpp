#pragma once
#include <psibase/Service.hpp>
#include <psibase/serviceEntry.hpp>

namespace SystemService
{
   struct RAccountSys : public psibase::Service<RAccountSys>
   {
      static constexpr auto service = psibase::AccountNumber("raccount-sys");

      auto serveSys(psibase::HttpRequest request) -> std::optional<psibase::HttpReply>;
      void storeSys(std::string path, std::string contentType, std::vector<char> content);
   };
   PSIO_REFLECT(RAccountSys,
                method(serveSys, request),
                method(storeSys, path, contentType, content))
}  // namespace SystemService
