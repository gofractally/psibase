#pragma once
#include <psibase/Rpc.hpp>
#include <psibase/Service.hpp>
#include <psibase/serveContent.hpp>
#include <psibase/serviceEntry.hpp>

namespace SystemService
{
   class RAuthSys : public psibase::Service<RAuthSys>
   {
     public:
      static constexpr auto service = psibase::AccountNumber("r-auth-sys");
      using Tables                  = psibase::ServiceTables<psibase::WebContentTable>;

      auto serveSys(psibase::HttpRequest request) -> std::optional<psibase::HttpReply>;
      void storeSys(std::string path, std::string contentType, std::vector<char> content);
   };
   PSIO_REFLECT(RAuthSys,  //
                method(serveSys, request),
                method(storeSys, path, contentType, content))
}  // namespace SystemService
