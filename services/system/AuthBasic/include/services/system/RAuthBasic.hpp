#pragma once
#include <psibase/Rpc.hpp>
#include <psibase/Service.hpp>
#include <psibase/serveContent.hpp>
#include <psibase/serviceEntry.hpp>

namespace SystemService
{
   class RAuthBasic : public psibase::Service<RAuthBasic>
   {
     public:
      static constexpr auto service = psibase::AccountNumber("r-auth-basic");
      using Tables                  = psibase::ServiceTables<psibase::WebContentTable>;

      auto serveSys(psibase::HttpRequest request) -> std::optional<psibase::HttpReply>;
      void storeSys(std::string path, std::string contentType, std::vector<char> content);
   };
   PSIO_REFLECT(RAuthBasic,  //
                method(serveSys, request),
                method(storeSys, path, contentType, content))
}  // namespace SystemService
