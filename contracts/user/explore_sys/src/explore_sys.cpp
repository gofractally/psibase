#include "contracts/user/explore_sys.hpp"

#include <contracts/system/proxy_sys.hpp>
#include <psibase/dispatch.hpp>
#include <psibase/serveContent.hpp>
#include <psibase/serveGraphQL.hpp>

using Tables = psibase::ContractTables<psibase::WebContentTable>;

struct QueryRoot
{
   auto blocks() const
   {
      return psibase::TableIndex<psibase::Block, uint32_t>{psibase::DbId::blockLog, {}, false};
   }
};
PSIO_REFLECT(  //
    QueryRoot,
    method(blocks))

namespace system_contract
{
   std::optional<psibase::RpcReplyData> explore_sys::serveSys(psibase::RpcRequestData request)
   {
      if (auto result = psibase::serveGraphQL(request, [] { return QueryRoot{}; }))
         return result;
      if (auto result = psibase::serveContent(request, Tables{getReceiver()}))
         return result;
      return std::nullopt;
   }

   void explore_sys::storeSys(std::string path, std::string contentType, std::vector<char> content)
   {
      psibase::check(getSender() == getReceiver(), "wrong sender");
      psibase::storeContent(std::move(path), std::move(contentType), std::move(content),
                            Tables{getReceiver()});
   }
}  // namespace system_contract

PSIBASE_DISPATCH(system_contract::explore_sys)
