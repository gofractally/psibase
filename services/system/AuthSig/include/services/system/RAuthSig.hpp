#pragma once
#include <psibase/Rpc.hpp>
#include <psibase/Service.hpp>
#include <psibase/serviceEntry.hpp>

namespace SystemService
{
   namespace AuthSig
   {
      class RAuthSig : public psibase::Service<RAuthSig>
      {
        public:
         static constexpr auto service = psibase::AccountNumber("r-auth-sig");

         auto serveSys(psibase::HttpRequest request) -> std::optional<psibase::HttpReply>;
      };
      PSIO_REFLECT(RAuthSig,  //
                   method(serveSys, request))
   }  // namespace AuthSig
}  // namespace SystemService
