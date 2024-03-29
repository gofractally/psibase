#pragma once
#include <psibase/Service.hpp>
#include <psibase/nativeTables.hpp>
#include <psibase/serviceEntry.hpp>

namespace SystemService
{
   struct Explorer : public psibase::Service<Explorer>
   {
      static constexpr auto service = psibase::AccountNumber("explorer");

      auto serveSys(psibase::HttpRequest request) -> std::optional<psibase::HttpReply>;
      void storeSys(std::string path, std::string contentType, std::vector<char> content);
   };
   PSIO_REFLECT(Explorer,  //
                method(serveSys, request),
                method(storeSys, path, contentType, content))
}  // namespace SystemService
