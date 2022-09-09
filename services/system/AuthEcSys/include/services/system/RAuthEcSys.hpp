#pragma once
#include <psibase/Rpc.hpp>
#include <psibase/Service.hpp>
#include <psibase/serveContent.hpp>
#include <psibase/serviceEntry.hpp>

namespace SystemService
{
   class RAuthEcSys : public psibase::Service<RAuthEcSys>
   {
     public:
      static constexpr auto service = psibase::AccountNumber("r-ath-ec-sys");
      using Tables                  = psibase::ServiceTables<psibase::WebContentTable>;

      auto serveSys(psibase::HttpRequest request) -> std::optional<psibase::HttpReply>;
      void storeSys(std::string path, std::string contentType, std::vector<char> content);

     private:
      std::optional<psibase::HttpReply> serveRestEndpoints(psibase::HttpRequest& request);
   };
   PSIO_REFLECT(RAuthEcSys,  //
                method(serveSys, request),
                method(storeSys, path, contentType, content))
}  // namespace SystemService
