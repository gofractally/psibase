#include <services/user/Events.hpp>

#include <services/system/HttpServer.hpp>

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
   int         i                                              = 0;
   double      d                                              = 0;
   friend bool operator==(const TestEvent&, const TestEvent&) = default;
};
PSIO_REFLECT(TestEvent, i, d)

std::ostream& operator<<(std::ostream& os, const TestEvent& e)
{
   os << psio::convert_to_json(e) << std::endl;
   return os;
}

TEST_CASE("events")
{
   DefaultTestChain chain;
   auto             events = chain.from(chain.addService<Events>("Events.wasm")).to<Events>();
   expect(chain.from(Events::service).to<HttpServer>().registerServer(Events::service).trace());

   ServiceSchema schema{.service = Events::service,
                        .schema  = SchemaBuilder().insert<int>("i32").insert<double>("f64").build(),
                        .history = {{MethodNumber{"testevent"},
                                     Object{.members = {{"i", Type{"i32"}}, {"d", Type{"f64"}}}}}}};
   expect(events.setSchema(schema).trace());
   expect(
       events.addIndex(DbId::historyEvent, Events::service, MethodNumber{"testevent"}, 0).trace());
   expect(
       events.addIndex(DbId::historyEvent, Events::service, MethodNumber{"testevent"}, 1).trace());
   expect(events.send(42, 1.414).trace());
   expect(events.send(72, 3.14159).trace());
   expect(events.send(42, 2.718).trace());
   expect(events.send(91, 1.618).trace());

   explain(
       chain,
       R"""(SELECT * FROM "history.events.testevent" WHERE d > 2 UNION SELECT * FROM "history.events.testevent" WHERE i >= 50 ORDER BY d)""");

   CHECK(query<TestEvent>(
             chain, R"""(SELECT i,d FROM "history.events.testevent" WHERE d > 2 ORDER BY d)""") ==
         std::vector<TestEvent>{{42, 2.718}, {72, 3.14159}});

   CHECK(
       query<TestEvent>(chain, R"""(SELECT i FROM "history.events.testevent" ORDER BY ROWID)""") ==
       std::vector<TestEvent>{{42}, {72}, {42}, {91}});

   CHECK(
       query<TestEvent>(
           chain,
           R"""(SELECT i FROM "history.events.testevent" WHERE i = '"history.unknown.unknown"')""") ==
       std::vector<TestEvent>{});
}
