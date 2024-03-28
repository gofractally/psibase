#pragma once

#include <psibase/Service.hpp>
#include <psibase/serviceEntry.hpp>

namespace SystemService
{
   struct RProducerSys : public psibase::Service<RProducerSys>
   {
      static constexpr auto service = psibase::AccountNumber("rprod-sys");

      std::optional<psibase::HttpReply> serveSys(psibase::HttpRequest request);

      void storeSys(std::string path, std::string contentType, std::vector<char> content);
   };
   PSIO_REFLECT(RProducerSys,
                method(serveSys, request),
                method(storeSys, path, contentType, content))
}  // namespace SystemService
