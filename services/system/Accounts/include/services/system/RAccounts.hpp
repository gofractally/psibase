#pragma once
#include <psibase/Service.hpp>
#include <psibase/serviceEntry.hpp>

namespace SystemService
{
   struct RAccounts : public psibase::Service<RAccounts>
   {
      static constexpr auto service = psibase::AccountNumber("r-accounts");

      auto serveSys(psibase::HttpRequest request) -> std::optional<psibase::HttpReply>;
   };
   PSIO_REFLECT(RAccounts, method(serveSys, request))
}  // namespace SystemService
