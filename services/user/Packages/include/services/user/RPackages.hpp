#pragma once

#include "Packages.hpp"

namespace UserService
{
   class RPackages : public psibase::Service<RPackages>
   {
     public:
      static constexpr auto service = psibase::AccountNumber("r-packages");

      auto serveSys(psibase::HttpRequest request) -> std::optional<psibase::HttpReply>;
   };
   PSIO_REFLECT(RPackages, method(serveSys, request))

}  // namespace UserService
