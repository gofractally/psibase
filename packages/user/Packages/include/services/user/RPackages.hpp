#pragma once

#include <psibase/Rpc.hpp>
#include <psibase/Service.hpp>

namespace UserService
{
   class RPackages : public psibase::Service
   {
     public:
      static constexpr auto service = psibase::AccountNumber("packages+1");

      auto serveSys(psibase::HttpRequest request) -> std::optional<psibase::HttpReply>;
   };
   PSIO_REFLECT(RPackages, method(serveSys, request))
   PSIBASE_REFLECT_TABLES(RPackages)

}  // namespace UserService
