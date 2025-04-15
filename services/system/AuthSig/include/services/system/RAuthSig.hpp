#pragma once
#include <psibase/Rpc.hpp>
#include <psibase/Service.hpp>

namespace SystemService
{
   namespace AuthSig
   {
      class RAuthSig : public psibase::Service
      {
        public:
         static constexpr auto service = psibase::AccountNumber("r-auth-sig");

         auto serveSys(psibase::HttpRequest request) -> std::optional<psibase::HttpReply>;
      };
      PSIO_REFLECT(RAuthSig,  //
                   method(serveSys, request))
      PSIBASE_REFLECT_TABLES(RAuthSig)
   }  // namespace AuthSig
}  // namespace SystemService
