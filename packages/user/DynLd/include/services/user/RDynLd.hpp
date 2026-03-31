#pragma once

#include <psibase/Rpc.hpp>
#include <psibase/Service.hpp>

namespace UserService
{
   struct RDynLd : psibase::Service
   {
      static constexpr auto service = psibase::AccountNumber{"r-dyn-ld"};
      auto                  serveSys(psibase::HttpRequest req) -> std::optional<psibase::HttpReply>;
   };
   PSIO_REFLECT(RDynLd, method(serveSys, request))
}  // namespace UserService
