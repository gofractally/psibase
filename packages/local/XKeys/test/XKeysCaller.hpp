#pragma once

#include <psibase/Rpc.hpp>
#include <psibase/Service.hpp>

namespace TestService
{
   struct XKeysCaller : psibase::Service
   {
      static constexpr auto             service = psibase::AccountNumber{"x-keyscall"};
      std::optional<psibase::HttpReply> serveSys(psibase::HttpRequest request);
   };
   PSIO_REFLECT(XKeysCaller, method(serveSys, request))
}  // namespace TestService
