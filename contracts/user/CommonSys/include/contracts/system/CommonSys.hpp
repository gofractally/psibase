#pragma once

#include <psibase/Contract.hpp>
#include <psibase/contractEntry.hpp>

namespace system_contract
{
   /// TODO: doc
   ///
   /// See [HTTP and Javascript](../http.md)
   struct CommonSys : psibase::Contract<CommonSys>
   {
      static constexpr auto contract = psibase::AccountNumber("common-sys");

      auto serveSys(psibase::HttpRequest request) -> std::optional<psibase::HttpReply>;
      auto serveCommon(psibase::HttpRequest request) -> std::optional<psibase::HttpReply>;
      void storeSys(std::string path, std::string contentType, std::vector<char> content);
   };

   // clang-format off
   PSIO_REFLECT(CommonSys, 
      method(serveSys, request), 
      method(serveCommon, request),
      method(storeSys, path, contentType, content)
   )
   // clang-format on
}  // namespace system_contract
