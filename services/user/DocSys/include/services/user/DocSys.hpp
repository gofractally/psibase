#pragma once

#include <psibase/Rpc.hpp>
#include <psibase/Service.hpp>
#include <psibase/psibase.hpp>
#include <services/system/CommonTables.hpp>

namespace UserService
{
   class DocSys : public psibase::Service<DocSys>
   {
     public:
      using Tables = psibase::ServiceTables<InitTable>;

      static constexpr auto service = psibase::AccountNumber("doc-sys");

      DocSys(psio::shared_view_ptr<psibase::Action> action);
      void init();
      auto serveSys(psibase::HttpRequest request) -> std::optional<psibase::HttpReply>;
      void storeSys(std::string path, std::string contentType, std::vector<char> content);
   };
   PSIO_REFLECT(DocSys,
                method(init),
                method(serveSys, request),
                method(storeSys, path, contentType, content))
}  // namespace UserService
