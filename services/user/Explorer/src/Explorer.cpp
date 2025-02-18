#include "services/user/Explorer.hpp"

#include <psibase/dispatch.hpp>
#include <psibase/serveGraphQL.hpp>
#include <services/system/CommonApi.hpp>
#include <services/system/HttpServer.hpp>

struct Query
{
   /// Retrieve blocks
   /// gt/ge/lt/le take block numbers
   /// first/last take that number of items from that page of results
   /// before/after use cursor based pagination
   auto blocks(std::optional<psibase::BlockNum> gt,
               std::optional<psibase::BlockNum> ge,
               std::optional<psibase::BlockNum> lt,
               std::optional<psibase::BlockNum> le,
               std::optional<uint32_t>          first,
               std::optional<uint32_t>          last,
               std::optional<std::string>       before,
               std::optional<std::string>       after) const
   {
      auto blockIdx =
          psibase::TableIndex<psibase::Block, uint32_t>{psibase::DbId::blockLog, {}, false};

      return psibase::makeConnection(blockIdx, gt, ge, lt, le, first, last, before, after);
   }
};
PSIO_REFLECT(Query, method(blocks, gt, ge, lt, le, first, last, before, after))

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
