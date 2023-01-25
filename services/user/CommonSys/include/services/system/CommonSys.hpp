#pragma once

#include <psibase/Service.hpp>
#include <psibase/serviceEntry.hpp>

namespace SystemService
{
   /// TODO: doc
   ///
   /// See [HTTP and Javascript](../http.md)
   struct CommonSys : psibase::Service<CommonSys>
   {
      static constexpr auto service = psibase::AccountNumber("common-sys");

      auto serveSys(psibase::HttpRequest request) -> std::optional<psibase::HttpReply>;

      /// This is a standard action that allows files to be stored in common-sys
      ///
      /// These files can later be retrieved using `serveSys`.
      void storeSys(std::string path, std::string contentType, std::vector<char> content);
   };

   // clang-format off
   PSIO_REFLECT(CommonSys,
      method(serveSys, request),
      method(storeSys, path, contentType, content)
   )
   // clang-format on
}  // namespace SystemService
