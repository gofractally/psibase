#pragma once
#include <psibase/Service.hpp>
#include <psibase/serviceEntry.hpp>

namespace SystemService
{
   struct RHttpServer : public psibase::Service<RHttpServer>
   {
      static constexpr auto service = psibase::AccountNumber("rhttp-server");

      auto serveSys(psibase::HttpRequest request) -> std::optional<psibase::HttpReply>;
      void storeSys(std::string path, std::string contentType, std::vector<char> content);
   };
   PSIO_REFLECT(RHttpServer,  //
                method(serveSys, request),
                method(storeSys, path, contentType, content))
}  // namespace SystemService
