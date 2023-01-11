#include <psibase/Table.hpp>
#include <psibase/dispatch.hpp>
#include <psibase/nativeTables.hpp>
#include <psibase/serveContent.hpp>
#include <psibase/serveGraphQL.hpp>
#include <psibase/servePackAction.hpp>
#include <psibase/serveSimpleUI.hpp>
#include <services/system/ProducerSys.hpp>
#include <services/system/RProducerSys.hpp>

#include <utility>

using namespace SystemService;
using namespace psibase;

using Tables = psibase::ServiceTables<psibase::WebContentTable>;

struct ProducerQuery
{
   std::vector<Producer> producers() const
   {
      auto status = psibase::kvGet<psibase::StatusRow>(StatusRow::db, StatusRow::key());
      if (!status)
         return {};
      return std::visit([](const auto& c) { return c.producers; }, status->consensus);
   }
};
PSIO_REFLECT(ProducerQuery, method(producers))

std::optional<HttpReply> RProducerSys::serveSys(HttpRequest request)
{
   if (auto result = servePackAction<ProducerSys>(request))
      return result;

   if (auto result = serveContent(request, Tables{getReceiver()}))
      return result;

   if (auto result = serveGraphQL(request, ProducerQuery{}))
      return result;

   if (auto result = serveSimpleUI<ProducerSys, true>(request))
      return result;

   return {};
}

void RProducerSys::storeSys(std::string path, std::string contentType, std::vector<char> content)
{
   check(getSender() == getReceiver(), "wrong sender");
   storeContent(std::move(path), std::move(contentType), std::move(content), Tables{getReceiver()});
}

PSIBASE_DISPATCH(SystemService::RProducerSys)
