#pragma once

#include <psibase/Rpc.hpp>
#include <psibase/Service.hpp>

namespace SystemService
{
   struct RSetCode : psibase::Service
   {
      static constexpr auto service = psibase::AccountNumber("r-setcode");

      /// Sets the flags that a particular service must be run with
      std::optional<psibase::HttpReply> serveSys(psibase::HttpRequest req);
   };
   PSIO_REFLECT(RSetCode, method(serveSys, req))
}  // namespace SystemService
