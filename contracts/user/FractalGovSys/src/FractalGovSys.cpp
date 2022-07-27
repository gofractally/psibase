#include "contracts/user/FractalGovSys.hpp"

#include <contracts/system/CommonSys.hpp>
#include <contracts/system/ProxySys.hpp>
#include <psibase/dispatch.hpp>
#include <psibase/serveContent.hpp>

using Tables = psibase::ContractTables<psibase::WebContentTable>;

namespace UserContract
{
   std::optional<psibase::RpcReplyData> FractalGovSys::serveSys(psibase::RpcRequestData request)
   {
      if (auto result = psibase::serveContent(request, Tables{getReceiver()}))
         return result;
      return std::nullopt;
   }

   void FractalGovSys::storeSys(std::string       path,
                                std::string       contentType,
                                std::vector<char> content)
   {
      psibase::check(getSender() == getReceiver(), "wrong sender");
      psibase::storeContent(std::move(path), std::move(contentType), std::move(content),
                            Tables{getReceiver()});
   }
}  // namespace UserContract

PSIBASE_DISPATCH(UserContract::FractalGovSys)
