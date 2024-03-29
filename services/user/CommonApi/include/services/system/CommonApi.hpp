#pragma once

#include <psibase/Service.hpp>
#include <psibase/serviceEntry.hpp>

namespace SystemService
{
   /// Services that contains the common files and libraries used by apps on psibase
   ///
   /// See [HTTP requests](../development/front-ends/reference/http-requests.md) and
   /// [JS libraries](../development/front-ends/reference/js-libraries.md)
   struct CommonApi : psibase::Service<CommonApi>
   {
      /// "common-api"
      static constexpr auto service = psibase::AccountNumber("common-api");

      /// This is a standard action that allows common-api to serve http requests.
      ///
      /// common-api responds to GET requests:
      /// - /common/thisservice
      /// - /common/rootdomain
      /// - /common/tapos/head
      /// and to POST requests:
      /// - /common/pack/Transaction
      /// - /common/pack/SignedTransaction
      ///
      /// Additionally, common-api will serve content at any path stored using `storeSys`
      auto serveSys(psibase::HttpRequest request) -> std::optional<psibase::HttpReply>;

      /// This is a standard action that allows files to be stored in common-api
      ///
      /// These files can later be retrieved using `serveSys`.
      void storeSys(std::string path, std::string contentType, std::vector<char> content);
   };

   // clang-format off
   PSIO_REFLECT(CommonApi,
      method(serveSys, request),
      method(storeSys, path, contentType, content)
   )
   // clang-format on
}  // namespace SystemService
