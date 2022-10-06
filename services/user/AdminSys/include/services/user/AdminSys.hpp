#pragma once

#include <psibase/AccountNumber.hpp>
#include <psibase/Rpc.hpp>

namespace SystemService
{
   struct AdminSys
   {
      static constexpr auto service = psibase::AccountNumber("admin-sys");

      auto serveSys(psibase::HttpRequest request) -> std::optional<psibase::HttpReply>;
      void storeSys(std::string path, std::string contentType, std::vector<char> content);
   };
   PSIO_REFLECT(AdminSys,  //
                method(serveSys, request),
                method(storeSys, path, contentType, content))
}  // namespace SystemService
