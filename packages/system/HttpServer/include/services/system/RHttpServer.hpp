#pragma once
#include <psibase/Service.hpp>
#include <psibase/serviceEntry.hpp>

namespace SystemService
{
   struct RHttpServer : public psibase::Service
   {
      static constexpr auto service = psibase::AccountNumber("r-http");

      auto serveSys(psibase::HttpRequest request) -> std::optional<psibase::HttpReply>;
   };
   PSIO_REFLECT(RHttpServer,  //
                method(serveSys, request))
   PSIBASE_REFLECT_TABLES(RHttpServer)
}  // namespace SystemService
