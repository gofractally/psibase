#include "contracts/system/RProxySys.hpp"

#include <contracts/system/ProxySys.hpp>
#include <psibase/dispatch.hpp>
#include <psibase/serveContent.hpp>
#include <psibase/serveSimpleUI.hpp>

using namespace psibase;
using Tables = psibase::ContractTables<psibase::WebContentTable>;

namespace system_contract
{
   std::optional<RpcReplyData> RProxySys::serveSys(RpcRequestData request)
   {
      if (auto result = psibase::serveSimpleUI<ProxySys, true>(request))
         return result;
      if (auto result = psibase::serveContent(request, Tables{getReceiver()}))
         return result;
      return std::nullopt;
   }  // serveSys

   void RProxySys::storeSys(std::string path, std::string contentType, std::vector<char> content)
   {
      psibase::check(getSender() == getReceiver(), "wrong sender");
      psibase::storeContent(std::move(path), std::move(contentType), std::move(content),
                            Tables{getReceiver()});
   }
}  // namespace system_contract

PSIBASE_DISPATCH(system_contract::RProxySys)
