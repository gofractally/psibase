#include "services/user/AdminSys.hpp"

#include <psibase/dispatch.hpp>
#include <psibase/serveContent.hpp>

using Tables = psibase::ServiceTables<psibase::WebContentTable>;

namespace SystemService
{
   std::optional<psibase::HttpReply> AdminSys::serveSys(psibase::HttpRequest request)
   {
      if (auto result = psibase::serveContent(request, Tables{psibase::getReceiver()}))
         return result;
      return std::nullopt;
   }

   void AdminSys::storeSys(std::string path, std::string contentType, std::vector<char> content)
   {
      psibase::check(psibase::getSender() == psibase::getReceiver(), "wrong sender");
      psibase::storeContent(std::move(path), std::move(contentType), std::move(content),
                            Tables{psibase::getReceiver()});
   }
}  // namespace SystemService

PSIBASE_DISPATCH(SystemService::AdminSys)
