#pragma once
#include <psibase/Service.hpp>
#include <psibase/nativeTables.hpp>
#include <psibase/serviceEntry.hpp>

namespace SystemService
{
   struct Explorer : public psibase::Service
   {
      static constexpr auto service = psibase::AccountNumber("explorer");

      auto serveSys(psibase::HttpRequest request) -> std::optional<psibase::HttpReply>;
   };
   PSIO_REFLECT(Explorer,  //
                method(serveSys, request))
}  // namespace SystemService
