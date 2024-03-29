#pragma once

#include <psibase/Service.hpp>
#include <psibase/serviceEntry.hpp>

namespace SystemService
{
   struct RProducer : public psibase::Service<RProducer>
   {
      static constexpr auto service = psibase::AccountNumber("r-prod-sys");

      std::optional<psibase::HttpReply> serveSys(psibase::HttpRequest request);

      void storeSys(std::string path, std::string contentType, std::vector<char> content);
   };
   PSIO_REFLECT(RProducer, method(serveSys, request), method(storeSys, path, contentType, content))
}  // namespace SystemService
