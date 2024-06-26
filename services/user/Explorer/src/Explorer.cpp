#include "services/user/Explorer.hpp"

#include <psibase/dispatch.hpp>
#include <psibase/serveContent.hpp>
#include <psibase/serveGraphQL.hpp>
#include <services/system/CommonApi.hpp>
#include <services/system/HttpServer.hpp>

using Tables = psibase::ServiceTables<psibase::WebContentTable>;

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
      if (auto result = psibase::serveContent(request, Tables{psibase::getReceiver()}))
         return result;
      return std::nullopt;
   }

   void Explorer::storeSys(std::string path, std::string contentType, std::vector<char> content)
   {
      psibase::check(psibase::getSender() == psibase::getReceiver(), "wrong sender");
      psibase::storeContent(std::move(path), std::move(contentType), std::move(content),
                            Tables{psibase::getReceiver()});
   }
}  // namespace SystemService

PSIBASE_DISPATCH(SystemService::Explorer)
