#pragma once

#include <optional>
#include <psibase/AccountNumber.hpp>
#include <psibase/Rpc.hpp>
#include <psibase/Service.hpp>
#include <psio/reflect.hpp>

namespace UserService
{
   struct REvents : psibase::Service<REvents>
   {
      static constexpr psibase::AccountNumber service{"r-events"};
      // Standard HTTP API
      std::optional<psibase::HttpReply> serveSys(const psibase::HttpRequest&);
   };
   PSIO_REFLECT(REvents, method(serveSys, request))

}  // namespace UserService
