#include "services/user/Explorer.hpp"

#include <psibase/dispatch.hpp>
#include <psibase/serveGraphQL.hpp>
#include <services/system/CommonApi.hpp>
#include <services/system/HttpServer.hpp>

struct Query
{
   auto blocks() const
   {
      return psibase::TableIndex<psibase::Block, uint32_t>{psibase::DbId::blockLog, {}, false};
   }
};
PSIO_REFLECT(  //
    Query,
    method(blocks))

namespace SystemService
{
   std::optional<psibase::HttpReply> Explorer::serveSys(psibase::HttpRequest request)
   {
      if (auto result = psibase::serveGraphQL(request, Query{}))
         return result;
      return std::nullopt;
   }
}  // namespace SystemService

PSIBASE_DISPATCH(SystemService::Explorer)
