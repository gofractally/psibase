#pragma once
#include <psibase/Rpc.hpp>
#include <psibase/Service.hpp>

namespace SystemService
{
   class RAuthDelegate : public psibase::Service
   {
     public:
      static constexpr auto service = psibase::AccountNumber("auth-delg+1");

      auto serveSys(psibase::HttpRequest request) -> std::optional<psibase::HttpReply>;
   };
   PSIO_REFLECT(RAuthDelegate,  //
                method(serveSys, request))
   PSIBASE_REFLECT_TABLES(RAuthDelegate)
}  // namespace SystemService
