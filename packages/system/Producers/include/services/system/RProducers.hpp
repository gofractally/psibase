#pragma once

#include <psibase/Service.hpp>
#include <psibase/serviceEntry.hpp>

namespace SystemService
{
   struct RProducers : public psibase::Service
   {
      static constexpr auto service = psibase::AccountNumber("r-prods");

      std::optional<psibase::HttpReply> serveSys(psibase::HttpRequest request);
   };
   PSIO_REFLECT(RProducers, method(serveSys, request))
   PSIBASE_REFLECT_TABLES(RProducers)
}  // namespace SystemService
