#pragma once
#include <psibase/Rpc.hpp>
#include <psibase/Service.hpp>

namespace SystemService
{
   class RAuthDelegate : public psibase::Service
   {
     public:
      static constexpr auto service = psibase::AccountNumber("r-auth-dlg");

      auto serveSys(psibase::HttpRequest request) -> std::optional<psibase::HttpReply>;
   };
   PSIO_REFLECT(RAuthDelegate,  //
                method(serveSys, request))
}  // namespace SystemService
