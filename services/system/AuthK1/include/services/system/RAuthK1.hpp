#pragma once
#include <psibase/Rpc.hpp>
#include <psibase/Service.hpp>
#include <psibase/serveContent.hpp>
#include <psibase/serviceEntry.hpp>

namespace SystemService
{
   class RAuthK1 : public psibase::Service<RAuthK1>
   {
     public:
      static constexpr auto service = psibase::AccountNumber("r-auth-k1");
      using Tables                  = psibase::ServiceTables<psibase::WebContentTable>;

      auto serveSys(psibase::HttpRequest request) -> std::optional<psibase::HttpReply>;
      void storeSys(std::string path, std::string contentType, std::vector<char> content);
   };
   PSIO_REFLECT(RAuthK1,  //
                method(serveSys, request),
                method(storeSys, path, contentType, content))
}  // namespace SystemService
