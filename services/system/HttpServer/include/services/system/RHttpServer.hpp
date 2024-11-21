#pragma once
#include <psibase/Service.hpp>
#include <psibase/serviceEntry.hpp>

namespace SystemService
{
   struct RHttpServer : public psibase::Service
   {
      static constexpr auto service = psibase::AccountNumber("rhttp-server");

      auto serveSys(psibase::HttpRequest request) -> std::optional<psibase::HttpReply>;
   };
   PSIO_REFLECT(RHttpServer,  //
                method(serveSys, request))
}  // namespace SystemService
