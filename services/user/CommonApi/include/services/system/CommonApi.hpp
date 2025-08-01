#pragma once

#include <psibase/Service.hpp>
#include <psibase/serviceEntry.hpp>
#include <services/system/HttpServer.hpp>

namespace SystemService
{
   /// Services that contains the common files and libraries used by apps on psibase
   ///
   /// See [HTTP requests](../development/front-ends/reference/http-requests.md) and
   /// [JS libraries](../development/front-ends/reference/js-libraries.md)
   struct CommonApi : psibase::Service
   {
      /// "common-api"
      static constexpr auto service = HttpServer::commonApiService;
      static constexpr auto prefix  = HttpServer::commonApiPrefix;

      /// This is a standard action that allows common-api to serve http requests.
      ///
      /// common-api responds to GET requests:
      /// - /common/chainid
      /// - /common/thisservice
      /// - /common/rootdomain
      /// - /common/tapos/head
      /// and to POST requests:
      /// - /common/pack/Transaction
      /// - /common/pack/SignedTransaction
      auto serveSys(psibase::HttpRequest request) -> std::optional<psibase::HttpReply>;
   };

   // clang-format off
   PSIO_REFLECT(CommonApi,
      method(serveSys, request),
   )
   PSIBASE_REFLECT_TABLES(CommonApi)
   // clang-format on
}  // namespace SystemService
