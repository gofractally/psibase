#include "contracts/system/RAuthEcSys.hpp"

#include <contracts/system/AuthEcSys.hpp>
#include <contracts/system/ProxySys.hpp>
#include <psibase/dispatch.hpp>
#include <psibase/serveContent.hpp>
#include <psibase/serveSimpleUI.hpp>

using namespace psibase;
using Tables = psibase::ContractTables<psibase::WebContentTable>;

namespace system_contract
{
   std::optional<RpcReplyData> RAuthEcSys::serveSys(RpcRequestData request)
   {
      if (auto result = psibase::serveContent(request, Tables{getReceiver()}))
         return result;

      if (auto result = servePackAction<AuthEcSys>(request))
         return result;

      if (auto result = psibase::serveSimpleUI<AuthEcSys, true>(request))
         return result;

      return std::nullopt;

   }  // serveSys

   void RAuthEcSys::storeSys(std::string path, std::string contentType, std::vector<char> content)
   {
      psibase::check(getSender() == getReceiver(), "wrong sender");
      psibase::storeContent(std::move(path), std::move(contentType), std::move(content),
                            Tables{getReceiver()});
   }
}  // namespace system_contract

PSIBASE_DISPATCH(system_contract::RAuthEcSys)
