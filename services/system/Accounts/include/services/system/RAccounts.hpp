#pragma once
#include <psibase/Service.hpp>
#include <psibase/serviceEntry.hpp>

namespace SystemService
{
   struct RAccounts : public psibase::Service<RAccounts>
   {
      static constexpr auto service = psibase::AccountNumber("raccounts");

      auto serveSys(psibase::HttpRequest request) -> std::optional<psibase::HttpReply>;
      void storeSys(std::string path, std::string contentType, std::vector<char> content);
   };
   PSIO_REFLECT(RAccounts, method(serveSys, request), method(storeSys, path, contentType, content))
}  // namespace SystemService
