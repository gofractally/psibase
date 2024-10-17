#pragma once

#include <psibase/Service.hpp>
#include <psibase/serviceEntry.hpp>

namespace SystemService
{
   struct RProducers : public psibase::Service<RProducers>
   {
      static constexpr auto service = psibase::AccountNumber("r-producers");

      std::optional<psibase::HttpReply> serveSys(psibase::HttpRequest request);
   };
   PSIO_REFLECT(RProducers, method(serveSys, request))
}  // namespace SystemService
