#include "event-service.hpp"

#include <psibase/dispatch.hpp>
#include <psibase/serveGraphQL.hpp>
#include <services/system/HttpServer.hpp>
#include <services/user/Events.hpp>

using namespace psibase;

void EventService::init()
{
   to<SystemService::HttpServer>().registerServer(EventService::service);

   using Events = UserService::EventIndex;
   to<Events>().setSchema(ServiceSchema::make<EventService>());
}

psibase::EventNumber EventService::foo(std::string s, int i)
{
   return emit().history().e(s, i);
}

void EventService::foo2(std::string s, int i)
{
   emit().history().e(s, i);
}

psibase::EventNumber EventService::emitMerkle(std::string s)
{
   return emit().merkle().m(s);
}

psibase::EventNumber EventService::emitFail(std::string s, int i)
{
   emit().history().e(s, i);
   abortMessage("die");
}

void EventService::emitExample(ExampleRecord r)
{
   emit().history().e2(r);
}

struct ExampleRecordQuery
{
   ExampleRecord r;
};
PSIO_REFLECT(ExampleRecordQuery, r);

struct FooEventRecord
{
   std::string s;
   int         i;
};
PSIO_REFLECT(FooEventRecord, s, i);

struct Query
{
   auto foo2Events(std::optional<int32_t>     first,
                   std::optional<int32_t>     last,
                   std::optional<std::string> before,
                   std::optional<std::string> after) const
   {
      return EventQuery<FooEventRecord>("history.event-service.e")
          .first(first)
          .last(last)
          .before(before)
          .after(after)
          .query();
   }

   auto exampleRecords(std::optional<int32_t>     first,
                       std::optional<int32_t>     last,
                       std::optional<std::string> before,
                       std::optional<std::string> after) const
   {
      return EventQuery<ExampleRecordQuery>("history.event-service.e2")
          .first(first)
          .last(last)
          .before(before)
          .after(after)
          .query();
   }
};
PSIO_REFLECT(Query,  //
             method(foo2Events, first, last, before, after),
             method(exampleRecords, first, last, before, after))

std::optional<psibase::HttpReply> EventService::serveSys(psibase::HttpRequest request)
{
   if (auto result = serveSchema<EventService>(request))
      return result;
   if (auto result = serveGraphQL(request, Query{}))
      return result;

   return std::nullopt;
}

PSIBASE_DISPATCH(EventService)
