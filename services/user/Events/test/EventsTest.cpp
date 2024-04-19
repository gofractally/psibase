#include <services/user/Events.hpp>

#include <services/system/HttpServer.hpp>
#include "TestService.hpp"

#define CATCH_CONFIG_MAIN

#include <psibase/DefaultTestChain.hpp>

using namespace psibase;
using namespace SystemService;
using namespace UserService;
using namespace psio::schema_types;

HttpRequest makeQuery(std::string_view s)
{
   return {.host        = "events.psibase.io",
           .rootHost    = "psibase.io",
           .method      = "POST",
           .target      = "/sql",
           .contentType = "application/sql",
           .body        = std::vector(s.begin(), s.end())};
}

template <typename R>
std::vector<R> query(TestChain& chain, std::string_view s)
{
   auto response = chain.http(makeQuery(s));
   CHECK(response.contentType == "application/json");
   response.body.push_back('\0');
   psio::json_token_stream stream(response.body.data());
   return psio::from_json<std::vector<R>>(stream);
}

struct ExplainQueryPlan
{
   std::int64_t id;
   std::int64_t parent;
   std::string  detail;
};
PSIO_REFLECT(ExplainQueryPlan, id, parent, detail)

void explain(TestChain& chain, std::string_view s)
{
   auto plan = query<ExplainQueryPlan>(chain, std::string("EXPLAIN QUERY PLAN ") + std::string(s));
   std::vector<std::int64_t> stack;
   for (const auto& row : plan)
   {
      while (!stack.empty() && stack.back() != row.parent)
         stack.pop_back();
      std::cout << std::setw(stack.size() * 2) << "";
      std::cout << row.detail << std::endl;
      stack.push_back(row.id);
   }
}

struct TestEvent
{
   int                       i = 0;
   double                    d = 0;
   std::vector<std::int32_t> v;
   std::string               s;
   friend bool               operator==(const TestEvent&, const TestEvent&) = default;
};
PSIO_REFLECT(TestEvent, i, d, v, s)

std::ostream& operator<<(std::ostream& os, const TestEvent& e)
{
   os << psio::convert_to_json(e) << std::endl;
   return os;
}

struct Opt
{
   std::optional<std::int32_t> opt;
   friend bool                 operator==(const Opt&, const Opt&) = default;
};
PSIO_REFLECT(Opt, opt)

std::ostream& operator<<(std::ostream& os, const Opt& e)
{
   os << psio::convert_to_json(e) << std::endl;
   return os;
}

TEST_CASE("events")
{
   DefaultTestChain chain;
   chain.addService<Events>("Events.wasm");
   expect(chain.from(Events::service).to<HttpServer>().registerServer(Events::service).trace());

   auto testService = chain.from(chain.addService<TestService>("Events-TestService.wasm"));

   auto schema = ServiceSchema::make<TestService>();
   std::cout << psio::format_json(schema) << std::endl;
   expect(testService.to<Events>().setSchema(schema).trace());
   expect(testService.to<TestService>().send(42, 1.414, std::vector{1}, "a").trace());
   expect(testService.to<TestService>().send(72, 3.14159, std::vector{2}, "b").trace());
   expect(testService.to<Events>()
              .addIndex(DbId::historyEvent, TestService::service, MethodNumber{"testevent"}, 0)
              .trace());
   expect(testService.to<Events>()
              .addIndex(DbId::historyEvent, TestService::service, MethodNumber{"testevent"}, 1)
              .trace());
   expect(testService.to<TestService>().send(42, 2.718, std::vector{3}, "c").trace());
   expect(testService.to<TestService>().send(91, 1.618, std::vector{4}, "d").trace());

   explain(
       chain,
       R"""(SELECT * FROM "history.test-service.testevent" WHERE d > 2 UNION SELECT * FROM "history.test-service.testevent" WHERE i >= 50 ORDER BY d)""");

   CHECK(
       query<TestEvent>(
           chain,
           R"""(SELECT i,d,v,s FROM "history.test-service.testevent" WHERE d > 2 ORDER BY d)""") ==
       std::vector<TestEvent>{{42, 2.718, {3}, "c"}, {72, 3.14159, {2}, "b"}});

   CHECK(query<TestEvent>(
             chain,
             R"""(SELECT i,d FROM "history.test-service.testevent" WHERE d > 2 ORDER BY d)""") ==
         std::vector<TestEvent>{{42, 2.718}, {72, 3.14159}});

   CHECK(query<TestEvent>(chain,
                          R"""(SELECT i FROM "history.test-service.testevent" ORDER BY ROWID)""") ==
         std::vector<TestEvent>{{42}, {72}, {42}, {91}});

   CHECK(
       query<TestEvent>(
           chain,
           R"""(SELECT i FROM "history.test-service.testevent" WHERE i = '"history.unknown.unknown"')""") ==
       std::vector<TestEvent>{});

   expect(testService.to<TestService>().sendOptional(std::nullopt).trace());
   expect(testService.to<TestService>().sendOptional(42).trace());
   CHECK(query<Opt>(chain, R"""(SELECT * FROM "history.test-service.opt" ORDER BY ROWID)""") ==
         std::vector<Opt>{{}, {42}});
}
