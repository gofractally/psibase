#pragma once

#include "PackageSys.hpp"

namespace UserService
{
   class RPackageSys : public psibase::Service<RPackageSys>
   {
     public:
      static constexpr auto service = psibase::AccountNumber("rpackage-sys");

      auto serveSys(psibase::HttpRequest request) -> std::optional<psibase::HttpReply>;
      void storeSys(std::string path, std::string contentType, std::vector<char> content);
   };
   PSIO_REFLECT(RPackageSys,
                method(serveSys, request),
                method(storeSys, path, contentType, content))

}  // namespace UserService
