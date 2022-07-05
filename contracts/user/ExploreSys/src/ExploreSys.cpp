#include "contracts/user/ExploreSys.hpp"

#include <contracts/system/CommonSys.hpp>
#include <contracts/system/ProxySys.hpp>
#include <psibase/dispatch.hpp>
#include <psibase/serveContent.hpp>
#include <psibase/serveGraphQL.hpp>

using Tables = psibase::ContractTables<psibase::WebContentTable>;

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

namespace system_contract
{
   std::optional<psibase::RpcReplyData> ExploreSys::serveSys(psibase::RpcRequestData request)
   {
      if (auto result = at<psibase::CommonSys>().serveCommon(request).unpack())
         return result;
      if (auto result = psibase::serveGraphQL(request, Query{}))
         return result;
      if (auto result = psibase::serveContent(request, Tables{getReceiver()}))
         return result;
      return std::nullopt;
   }

   void ExploreSys::storeSys(std::string path, std::string contentType, std::vector<char> content)
   {
      psibase::check(getSender() == getReceiver(), "wrong sender");
      psibase::storeContent(std::move(path), std::move(contentType), std::move(content),
                            Tables{getReceiver()});
   }
}  // namespace system_contract

PSIBASE_DISPATCH(system_contract::ExploreSys)
