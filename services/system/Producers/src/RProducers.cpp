#include <psibase/Table.hpp>
#include <psibase/dispatch.hpp>
#include <psibase/nativeTables.hpp>
#include <psibase/serveGraphQL.hpp>
#include <psibase/servePackAction.hpp>
#include <psibase/serveSimpleUI.hpp>
#include <services/system/Producers.hpp>
#include <services/system/RProducers.hpp>

#include <utility>

using namespace SystemService;
using namespace psibase;

struct ProducerQuery
{
   std::vector<Producer> producers() const
   {
      return std::visit([](const auto& c) { return c.producers; }, consensus());
   }
   std::vector<Producer> nextProducers() const
   {
      if (auto c = nextConsensus())
         return std::visit([](const auto& c) { return c.producers; }, *c);
      return {};
   }
   Consensus consensus() const
   {
      auto status = psibase::kvGet<psibase::StatusRow>(StatusRow::db, StatusRow::key());
      if (!status)
         return {};
      return std::move(status->consensus);
   }
   std::optional<Consensus> nextConsensus() const
   {
      auto status = psibase::kvGet<psibase::StatusRow>(StatusRow::db, StatusRow::key());
      if (!status || !status->nextConsensus)
         return {};
      return std::move(std::get<0>(*status->nextConsensus));
   }
   std::optional<BlockNum> jointStart() const
   {
      auto status = psibase::kvGet<psibase::StatusRow>(StatusRow::db, StatusRow::key());
      if (!status || !status->nextConsensus)
         return {};
      return std::get<1>(*status->nextConsensus);
   }
};
PSIO_REFLECT(ProducerQuery,
             method(producers),
             method(nextProducers),
             method(consensus),
             method(nextConsensus),
             method(jointStart))

std::optional<HttpReply> RProducers::serveSys(HttpRequest request)
{
   if (auto result = servePackAction<Producers>(request))
      return result;

   if (auto result = serveSchema<Producers>(request))
      return result;

   if (auto result = serveGraphQL(request, ProducerQuery{}))
      return result;

   if (auto result = serveSimpleUI<Producers, true>(request))
      return result;

   return {};
}

PSIBASE_DISPATCH(SystemService::RProducers)
