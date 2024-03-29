#pragma once

#include <psibase/Service.hpp>
#include <psibase/serviceEntry.hpp>

namespace SystemService
{
   struct RProducers : public psibase::Service<RProducers>
   {
      static constexpr auto service = psibase::AccountNumber("r-prod-sys");

      std::optional<psibase::HttpReply> serveSys(psibase::HttpRequest request);

      void storeSys(std::string path, std::string contentType, std::vector<char> content);
   };
   PSIO_REFLECT(RProducers, method(serveSys, request), method(storeSys, path, contentType, content))
}  // namespace SystemService
