#include <services/user/Events.hpp>
#include <services/user/REvents.hpp>

#include <iomanip>
#include <services/system/HttpServer.hpp>
#include <services/system/Transact.hpp>
#include <services/user/Packages.hpp>
#include "TestService.hpp"

#include <catch2/catch_all.hpp>
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
   INFO(static_cast<unsigned>(response.status)
        << " " << std::string(response.body.begin(), response.body.end()));
   CHECK(response.status == HttpStatus::ok);
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

template <typename T>
   requires requires { typename T::json_stream_operator; }
std::ostream& operator<<(std::ostream& os, const T& value)
{
   os << psio::convert_to_json(value) << std::endl;
   return os;
}

#define REFLECT_EVENT(name, ...)                               \
   using json_stream_operator                       = void;    \
   friend bool operator==(const name&, const name&) = default; \
   PSIO_REFLECT(name, __VA_ARGS__)

struct TestEvent
{
   int                       i = 0;
   double                    d = 0;
   std::vector<std::int32_t> v;
   std::string               s;
   REFLECT_EVENT(TestEvent, i, d, v, s)
};

struct Opt
{
   std::optional<std::int32_t> opt;
   REFLECT_EVENT(Opt, opt)
};

struct Str
{
   std::string s;
   REFLECT_EVENT(Str, s)
};

struct Acct
{
   AccountNumber a;
   REFLECT_EVENT(Acct, a)
};

struct Time
{
   TimePointSec t;
   REFLECT_EVENT(Time, t)
};

TEST_CASE("events")
{
   DefaultTestChain chain;
   auto testService = chain.from(chain.addService<TestService>("Events-TestService.wasm"));
   auto mallory     = chain.from(chain.addAccount("mallory"));

   auto schema = ServiceSchema::make<TestService>();
   std::cout << psio::format_json(schema) << std::endl;
   expect(testService.to<Packages>().setSchema(schema).trace());
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

   expect(testService.to<Events>()
              .addIndex(DbId::historyEvent, TestService::service, MethodNumber{"opt"}, 0)
              .trace());

   CHECK(mallory.to<Events>()
             .addIndex(DbId::historyEvent, TestService::service, MethodNumber{"opt"}, 0)
             .failed("Wrong sender"));
   CHECK(testService.to<Events>()
             .addIndex(DbId::historyEvent, TestService::service, MethodNumber{"missing"}, 0)
             .failed("Unknown event"));
   CHECK(testService.to<Events>()
             .addIndex(DbId::historyEvent, TestService::service, MethodNumber{"testevent"}, 42)
             .failed("Unknown column"));

   explain(
       chain,
       R"""(SELECT * FROM "history.test-service.opt" WHERE opt > 10 AND OPT < 100 ORDER BY ROWID)""");

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

   // optional
   expect(testService.to<TestService>().sendOptional(std::nullopt).trace());
   expect(testService.to<TestService>().sendOptional(42).trace());
   CHECK(query<Opt>(chain, R"""(SELECT * FROM "history.test-service.opt" ORDER BY ROWID)""") ==
         std::vector<Opt>{{}, {42}});
   CHECK(
       query<Opt>(
           chain,
           R"""(SELECT * FROM "history.test-service.opt" WHERE opt > 10 AND opt < 100 ORDER BY ROWID)""") ==
       std::vector<Opt>{{42}});

   // optional with 8-bit value
   expect(testService.to<Events>()
              .addIndex(DbId::historyEvent, TestService::service, MethodNumber{"optb"}, 0)
              .trace());
   expect(testService.to<TestService>().sendOptional8(std::nullopt).trace());
   expect(testService.to<TestService>().sendOptional8(42).trace());

   explain(
       chain,
       R"""(SELECT * FROM "history.test-service.optb" WHERE opt > 10 AND opt < 100 ORDER BY ROWID)""");
   CHECK(query<Opt>(chain, R"""(SELECT * FROM "history.test-service.optb" ORDER BY ROWID)""") ==
         std::vector<Opt>{{}, {42}});
   CHECK(
       query<Opt>(
           chain,
           R"""(SELECT * FROM "history.test-service.optb" WHERE opt > 10 AND opt < 100 ORDER BY ROWID)""") ==
       std::vector<Opt>{{42}});

   // string keys
   expect(testService.to<Events>()
              .addIndex(DbId::historyEvent, TestService::service, MethodNumber{"str"}, 0)
              .trace());
   expect(testService.to<TestService>().sendString("").trace());
   expect(testService.to<TestService>().sendString("a").trace());
   expect(testService.to<TestService>().sendString("b").trace());
   CHECK(query<Str>(chain, R"""(SELECT * FROM "history.test-service.str" ORDER BY ROWID)""") ==
         std::vector<Str>{{""}, {"a"}, {"b"}});
   CHECK(query<Str>(
             chain,
             R"""(SELECT * FROM "history.test-service.str" WHERE s >= 'a' ORDER BY ROWID)""") ==
         std::vector<Str>{{"a"}, {"b"}});

   // account number keys
   expect(testService.to<TestService>().sendAccount(AccountNumber{"tkucanun"}).trace());
   expect(testService.to<TestService>().sendAccount(AccountNumber{"t1201"}).trace());
   expect(testService.to<TestService>().sendAccount(AccountNumber{"s"}).trace());
   CHECK(query<Acct>(chain, R"""(SELECT * FROM "history.test-service.account" ORDER BY ROWID)""") ==
         std::vector<Acct>{
             {AccountNumber{"tkucanun"}}, {AccountNumber{"t1201"}}, {AccountNumber{"s"}}});
   CHECK(
       query<Acct>(
           chain,
           R"""(SELECT * FROM "history.test-service.account" WHERE a >= 't1201' ORDER BY ROWID)""") ==
       std::vector<Acct>{{AccountNumber{"t1201"}}, {AccountNumber{"s"}}});
   // repeat the query using an index
   expect(testService.to<Events>()
              .addIndex(DbId::historyEvent, TestService::service, MethodNumber{"account"}, 0)
              .trace());
   CHECK(
       query<Acct>(
           chain,
           R"""(SELECT * FROM "history.test-service.account" WHERE a >= 't1201' ORDER BY ROWID)""") ==
       std::vector<Acct>{{AccountNumber{"t1201"}}, {AccountNumber{"s"}}});
   // Verify that an explicit collate on the comparison works
   CHECK(
       query<Acct>(
           chain,
           R"""(SELECT * FROM "history.test-service.account" WHERE a >= 't1201' COLLATE BINARY ORDER BY ROWID)""") ==
       std::vector<Acct>{{AccountNumber{"tkucanun"}}, {AccountNumber{"t1201"}}});

   // time
   expect(testService.to<TestService>().sendTime(TimePointSec{}).trace());
   CHECK(query<Time>(chain, R"""(SELECT * FROM "history.test-service.time")""") ==
         std::vector<Time>{{TimePointSec{}}});
}
