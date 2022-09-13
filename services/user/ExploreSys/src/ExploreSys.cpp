#include "services/user/ExploreSys.hpp"

#include <psibase/dispatch.hpp>
#include <psibase/serveContent.hpp>
#include <psibase/serveGraphQL.hpp>
#include <services/system/CommonSys.hpp>
#include <services/system/ProxySys.hpp>

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
   std::optional<psibase::HttpReply> ExploreSys::serveSys(psibase::HttpRequest request)
   {
      //      if (auto result = to<CommonSys>().serveCommon(request).unpack())
      //         return result;
      if (auto result = psibase::serveGraphQL(request, Query{}))
         return result;
      if (auto result = psibase::serveContent(request, Tables{psibase::getReceiver()}))
         return result;
      return std::nullopt;
   }

   void ExploreSys::storeSys(std::string path, std::string contentType, std::vector<char> content)
   {
      psibase::check(psibase::getSender() == psibase::getReceiver(), "wrong sender");
      psibase::storeContent(std::move(path), std::move(contentType), std::move(content),
                            Tables{psibase::getReceiver()});
   }
}  // namespace SystemService

PSIBASE_DISPATCH(SystemService::ExploreSys)
