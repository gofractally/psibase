#include "services/system/RProxySys.hpp"

#include <psibase/dispatch.hpp>
#include <psibase/serveContent.hpp>
#include <psibase/serveSimpleUI.hpp>
#include <services/system/ProxySys.hpp>

using namespace psibase;
using Tables = psibase::ServiceTables<psibase::WebContentTable>;

namespace SystemService
{
   std::optional<HttpReply> RProxySys::serveSys(HttpRequest request)
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
}  // namespace SystemService

PSIBASE_DISPATCH(SystemService::RProxySys)
