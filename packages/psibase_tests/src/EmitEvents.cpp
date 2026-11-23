#include <services/test/EmitEvents.hpp>

#include <psibase/dispatch.hpp>
#include <psibase/serveGraphQL.hpp>
#include <services/system/HttpServer.hpp>
#include <services/user/Events.hpp>
#include <services/user/Packages.hpp>

using namespace psibase;
using namespace TestService;

void EmitEvents::init()
{
   to<SystemService::HttpServer>().registerServer(EmitEvents::service);

   to<UserService::Packages>().setSchema(ServiceSchema::make<EmitEvents>());
}

psibase::EventNumber EmitEvents::foo(std::string s, int i)
{
   return emit().history().e(s, i);
}

void EmitEvents::foo2(std::string s, int i)
{
   emit().history().e(s, i);
}

psibase::EventNumber EmitEvents::emitMerkle(std::string s)
{
   return emit().merkle().m(s);
}

psibase::EventNumber EmitEvents::emitFail(std::string s, int i)
{
   emit().history().e(s, i);
   abortMessage("die");
}

void EmitEvents::emitExample(ExampleRecord r)
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
   auto foo2Events(psio::graphql::page_args page) const
   {
      return EventQuery<FooEventRecord>("history.event-svc.e").page(std::move(page)).query();
   }

   auto exampleRecords(psio::graphql::page_args page) const
   {
      return EventQuery<ExampleRecordQuery>("history.event-svc.e2").page(std::move(page)).query();
   }
};
PSIO_REFLECT(Query,  //
             method(foo2Events, page),
             method(exampleRecords, page))

std::optional<psibase::HttpReply> EmitEvents::serveSys(psibase::HttpRequest request)
{
   if (auto result = serveGraphQL(request, Query{}))
      return result;

   return std::nullopt;
}

PSIBASE_DISPATCH(EmitEvents)
