#pragma once

#include <psibase/Rpc.hpp>
#include <psibase/Service.hpp>
#include <psibase/nativeTables.hpp>

namespace TestService
{
   struct XSudo : psibase::Service
   {
      static constexpr auto             service = psibase::AccountNumber{"x-sudo"};
      static constexpr auto             flags   = psibase::CodeRow::isPrivileged;
      std::optional<psibase::HttpReply> serveSys(psibase::HttpRequest req);
   };
   PSIO_REFLECT(XSudo, method(serveSys, req))
}  // namespace TestService
